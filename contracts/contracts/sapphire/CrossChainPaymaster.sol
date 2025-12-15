// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import { RLPReader } from "@eth-optimism/contracts-bedrock/src/libraries/rlp/RLPReader.sol";

import { HashiProverUpgradeable } from "../hashi/prover/HashiProverUpgradeable.sol";
import { ReceiptProof } from "../hashi/prover/HashiProverStructs.sol";

import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import { ICrossChainPaymaster } from "./interfaces/ICrossChainPaymaster.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SapphireTypes } from "./libraries/SapphireTypes.sol";

/**
 * @title CrossChainPaymaster
 * @author Oasis Protocol Foundation
 * @notice Sapphire contract that verifies remote PaymentInitiated events via Hashi and distributes ROSE
 * @dev UUPS upgradeable. Uses ROFL price oracle for conversions. Duplicate prevention via paymentId.
 */
contract CrossChainPaymaster is
    Initializable,
    UUPSUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    HashiProverUpgradeable,
    ICrossChainPaymaster
{
    using RLPReader for RLPReader.RLPItem;
    using RLPReader for bytes;

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------
    bytes32 internal constant PAYMENT_INITIATED_TOPIC = keccak256(
        abi.encodePacked(
            "PaymentInitiated(address,address,address,uint256,bytes32)"
        )
    );

    /**
     * @notice Standard decimal scale for normalizing ROSE/USD feed prices
     * @dev All feed prices are normalized to this scale before averaging
     */
    uint8 internal constant NORMALIZED_DECIMALS = 18;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /**
     * @notice USD price feeds for tokens (token => Chainlink AggregatorV3Interface)
     * @dev Each feed should report TOKEN/USD (USD per 1 TOKEN) with its own decimals.
     */
    mapping(address => AggregatorV3Interface) public priceFeeds;

    /**
     * @notice ROSE/USD price feed address (USD per 1 ROSE)
     * @dev Single aggregated feed from ROFL price oracle
     */
    address public roseUsdFeed;

    /**
     * @notice Token decimal mappings (token => decimals)
     */
    mapping(address => uint8) public tokenDecimals;

    /**
     * @notice Staleness threshold for price feeds (in seconds)
     */
    uint256 public stalenessThreshold;

    /**
     * @notice Duplicate prevention mapping (paymentId => processed)
     */
    mapping(bytes32 => bool) public processedPayments;

    /**
     * @notice Chain configuration (chainId => config)
     */
    mapping(uint256 => SapphireTypes.ChainConfig) public chainConfigs;

    /**
     * @notice Authorized source vaults per chain
     */
    mapping(uint256 => mapping(address => bool)) public isAuthorizedVault;

    /**
     * @notice Distribution limits and counters
     */
    SapphireTypes.DistributionLimits public limits;

    // ---------------------------------------------------------------------
    // Initialization / Upgradeability
    // ---------------------------------------------------------------------

    /**
     * @notice Initializes the contract with owner and distribution limits
     * @param _owner Address to transfer ownership to
     * @param _shoyuBashi Hashi ShoyuBashi contract address
     * @param _limits Distribution limits for payments
     * @param _stalenessThreshold Maximum age for price data in seconds
     * @param _roseUsdFeed Price feed address for ROSE/USD
     */
    function initialize(
        address _owner,
        address _shoyuBashi,
        SapphireTypes.DistributionLimits memory _limits,
        uint256 _stalenessThreshold,
        address _roseUsdFeed
    ) external initializer {
        __ReentrancyGuard_init();
        __HashiProverUpgradeable_init(_shoyuBashi);
        __Pausable_init();
        __UUPSUpgradeable_init();

        stalenessThreshold = _stalenessThreshold;
        limits = _limits;

        // Require ROSE/USD feed
        if (_roseUsdFeed == address(0)) revert InvalidPriceFeed();
        roseUsdFeed = _roseUsdFeed;

        // Transfer ownership to requested owner if different
        if (_owner != owner()) {
            _transferOwnership(_owner);
        }
    }

    /**
     * @notice Authorizes contract upgrades (UUPS pattern)
     * @param newImplementation New implementation address
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function setPriceFeed(address token, address feed) external onlyOwner override {
        if (feed == address(0)) revert InvalidPriceFeed();
        emit PriceFeedUpdated(token, address(priceFeeds[token]), feed);
        priceFeeds[token] = AggregatorV3Interface(feed);
    }

    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function setRoseUsdFeed(address feed) external onlyOwner override {
        if (feed == address(0)) revert InvalidPriceFeed();
        address oldFeed = roseUsdFeed;
        roseUsdFeed = feed;
        emit RoseUsdFeedUpdated(oldFeed, feed);
    }

    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function setTokenDecimals(address token, uint8 decimals) external onlyOwner override {
        tokenDecimals[token] = decimals;
        emit TokenDecimalsSet(token, decimals);
    }

    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function setStalenessThreshold(uint256 threshold) external onlyOwner override {
        stalenessThreshold = threshold;
    }

    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function setChainConfig(uint256 chainId, SapphireTypes.ChainConfig calldata config) external onlyOwner override {
        chainConfigs[chainId] = config;
        emit ChainConfigUpdated(chainId, config);
    }

    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function setVaultAuthorization(uint256 chainId, address vault, bool authorized) external onlyOwner override {
        isAuthorizedVault[chainId][vault] = authorized;
        emit VaultAuthorizationUpdated(chainId, vault, authorized);
    }

    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function setDistributionLimits(
        uint128 dailyLimit,
        uint128 perTxLimit,
        bool enabled
    ) external onlyOwner override {
        limits.dailyLimit = dailyLimit;
        limits.perTxLimit = perTxLimit;
        limits.enabled = enabled;
        // reset window if changing config
        limits.lastResetDay = uint32(block.timestamp / 1 days);
        limits.currentDaily = 0;
        emit DistributionLimitsUpdated(dailyLimit, perTxLimit, enabled);
    }

    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function pause() external override onlyOwner{
        _pause();
    }

    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function unpause() external override onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Core: Verify proof and distribute ROSE
    // ---------------------------------------------------------------------

    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function processPayment(ReceiptProof calldata proof) external nonReentrant whenNotPaused override {
        _processPayment(proof);
    }

    /**
     * @notice Internal function to process a verified payment proof and distribute ROSE
     * @param proof The Hashi receipt proof containing the PaymentInitiated event
     */
    function _processPayment(ReceiptProof calldata proof) internal {
        // Ensure source chain is enabled
        SapphireTypes.ChainConfig memory cfg = chainConfigs[proof.chainId];
        if (!cfg.enabled) revert ChainDisabled(proof.chainId);

        // Verify event via Hashi (returns RLP-encoded Log: [address, topics[], data])
        bytes memory logEntry = verifyForeignEvent(proof);

        // Decode and validate event
        // Intentionally ignore unused returns (payer, eventPaymentId)
        address vault;
        address recipient;
        address token;
        uint256 amount;
        (vault, /* payer */, recipient, token, amount, /* eventPaymentId */) = _decodePaymentInitiated(logEntry);

        // Vault must be authorized for this chain
        if (!isAuthorizedVault[proof.chainId][vault]) revert VaultNotAuthorized(proof.chainId, vault);

        // Compute canonical paymentId from proof metadata
        uint256 txIndex = _decodeRlpUint(proof.transactionIndex);
        bytes32 paymentId = keccak256(abi.encode(
            proof.chainId,
            vault,
            proof.blockNumber,
            txIndex,
            proof.logIndex
        ));

        // Duplicate prevention
        if (processedPayments[paymentId]) revert DuplicatePayment(paymentId);

        uint256 roseAmount = _convertToRose(token, amount);

        // Enforce limits
        if (SapphireTypes.wouldExceedLimits(limits, uint128(roseAmount))) revert DistributionLimitExceeded();

        processedPayments[paymentId] = true;
        limits = SapphireTypes.updateDistributionLimits(limits, uint128(roseAmount));

        (bool ok, ) = payable(recipient).call{value: roseAmount}("");
        if (!ok) revert TransferFailed();

        emit PaymentProcessed(paymentId, roseAmount);
    }

    // ---------------------------------------------------------------------
    // Owner Withdrawal
    // ---------------------------------------------------------------------
    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function withdrawRose(address to, uint256 amount) external onlyOwner nonReentrant override {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        uint256 bal = address(this).balance;
        if (amount > bal) revert InsufficientBalance(bal, amount);
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit RoseWithdrawn(to, amount, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Views / Helpers
    // ---------------------------------------------------------------------

    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function calculateRoseAmount(address token, uint256 tokenAmount) external view override returns (uint256) {
        return _convertToRose(token, tokenAmount);
    }

    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function isPaymentProcessed(bytes32 paymentId) external view override returns (bool) {
        return processedPayments[paymentId];
    }

    // Decode PaymentInitiated log: [address, [topics...], data]
    /**
     * @notice Decodes a PaymentInitiated event log entry from RLP format
     * @param logEntry The RLP-encoded log entry from Hashi verification
     * @return vault The vault contract address that emitted the event
     * @return payer The address that initiated the payment
     * @return recipient The intended recipient of the ROSE distribution
     * @return token The token address used in the payment
     * @return amount The token amount paid
     * @return paymentId The deterministic payment identifier
     */
    function _decodePaymentInitiated(bytes memory logEntry) internal pure returns (
        address vault,
        address payer,
        address recipient,
        address token,
        uint256 amount,
        bytes32 paymentId
    ) {
        RLPReader.RLPItem[] memory fields = logEntry.toRLPItem().readList();
        if (fields.length != 3) revert InvalidEvent();

        // 0: address
        vault = address(bytes20(fields[0].readBytes()));

        // 1: topics[]
        RLPReader.RLPItem[] memory topics = fields[1].readList();
        if (topics.length != 4) revert InvalidEvent(); // sig + 3 indexed
        bytes32 sig = bytes32(topics[0].readBytes());
        if (sig != PAYMENT_INITIATED_TOPIC) revert InvalidEvent();
        payer = address(uint160(uint256(bytes32(topics[1].readBytes()))));
        recipient = address(uint160(uint256(bytes32(topics[2].readBytes()))));
        token = address(uint160(uint256(bytes32(topics[3].readBytes()))));

        // 2: data (abi.encode(amount, paymentId))
        bytes memory data = fields[2].readBytes();
        if (data.length == 0) revert InvalidEvent();
        (amount, paymentId) = abi.decode(data, (uint256, bytes32));
    }

    // Decode RLP-encoded uint to uint256
    /**
     * @notice Decodes an RLP-encoded bytes array to uint256
     * @param rlp The RLP-encoded bytes representing a uint value
     * @return The decoded uint256 value
     */
    function _decodeRlpUint(bytes memory rlp) internal pure returns (uint256) {
        bytes memory b = rlp.toRLPItem().readBytes();
        uint256 number;
        for (uint256 i = 0; i < b.length; i++) {
            number = number + uint256(uint8(b[i])) * (2 ** (8 * (b.length - (i + 1))));
        }
        return number;
    }

    // ---------------------------------------------------------------------
    // Internal Conversion Logic
    // ---------------------------------------------------------------------

    /**
     * @notice Converts token amount to ROSE amount using Chainlink-style price feeds
     * @dev Uses single aggregated ROSE/USD feed from ROFL price oracle
     * @param token The token address
     * @param tokenAmount The amount of tokens to convert
     * @return roseAmount The equivalent amount in ROSE
     */
    function _convertToRose(address token, uint256 tokenAmount) internal view returns (uint256 roseAmount) {
        AggregatorV3Interface tokenUsd = priceFeeds[token];
        if (address(tokenUsd) == address(0)) revert NoPriceFeedForToken(token);
        if (roseUsdFeed == address(0)) revert NoRoseUsdFeed();

        // Get token price data
        (uint80 tRound, int256 tPrice, , uint256 tUpdated, uint80 tAnsweredIn) = tokenUsd.latestRoundData();

        // Validate token price
        if (tPrice <= 0) revert InvalidPrice(tPrice);
        if (tAnsweredIn < tRound) revert StalePrice(0, 0);
        if (tUpdated == 0 || (block.timestamp > tUpdated && block.timestamp - tUpdated > stalenessThreshold)) revert StalePrice(tUpdated, stalenessThreshold);

        // Get ROSE/USD price (single aggregated feed from ROFL oracle)
        AggregatorV3Interface roseFeed = AggregatorV3Interface(roseUsdFeed);
        (uint80 rRound, int256 rPrice, , uint256 rUpdated, uint80 rAnsweredIn) = roseFeed.latestRoundData();

        // Validate ROSE price
        if (rPrice <= 0) revert InvalidPrice(rPrice);
        if (rAnsweredIn < rRound) revert StalePrice(0, 0);
        if (rUpdated == 0 || (block.timestamp > rUpdated && block.timestamp - rUpdated > stalenessThreshold)) revert StalePrice(rUpdated, stalenessThreshold);

        uint8 tokenDec = tokenDecimals[token];
        if (tokenDec == 0) tokenDec = 18;
        uint8 tDec = tokenUsd.decimals();
        uint8 rDec = roseFeed.decimals();

        // Normalize ROSE price to 18 decimals
        uint256 normalizedRosePrice;
        if (rDec < NORMALIZED_DECIMALS) {
            normalizedRosePrice = uint256(rPrice) * (10 ** (NORMALIZED_DECIMALS - rDec));
        } else if (rDec > NORMALIZED_DECIMALS) {
            normalizedRosePrice = uint256(rPrice) / (10 ** (rDec - NORMALIZED_DECIMALS));
        } else {
            normalizedRosePrice = uint256(rPrice);
        }

        // roseAmount = tokenAmount * (tokenUsd / roseUsd) adjusted to 18 decimals
        uint256 num = Math.mulDiv(tokenAmount, uint256(tPrice), 10 ** tokenDec);
        num = Math.mulDiv(num, 10 ** NORMALIZED_DECIMALS, 10 ** tDec);
        roseAmount = Math.mulDiv(num, 1e18, normalizedRosePrice);
    }

    /// @notice Accepts ROSE funding
    receive() external payable {}
}
