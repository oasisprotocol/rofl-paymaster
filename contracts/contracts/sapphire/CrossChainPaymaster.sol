// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {ICrossChainPaymaster} from "./interfaces/ICrossChainPaymaster.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SapphireTypes} from "./libraries/SapphireTypes.sol";

/**
 * @notice Interface for the Accounting contract
 */
interface IAccounting {
    function balances(
        address user,
        bytes32 tokenId
    ) external view returns (uint256);
    function transferFromLock(
        address userAddress,
        address toAddress,
        uint256 lockIndex,
        uint256 amount,
        bytes calldata signature
    ) external;
}

/**
 * @title CrossChainPaymaster
 * @author Oasis Protocol Foundation
 * @notice Sapphire contract that converts between ROSE and other tokens using Accounting module
 * @dev UUPS upgradeable. Handles inbound deposits (token -> ROSE) and outbound withdrawals (ROSE -> token).
 */
contract CrossChainPaymaster is
    Initializable,
    UUPSUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    ICrossChainPaymaster
{
    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /**
     * @notice Accounting contract that manages cross-chain balances
     */
    IAccounting public accounting;

    /**
     * @notice USD price feeds for tokens (tokenId => Chainlink AggregatorV3Interface)
     * @dev Each feed should report TOKEN/USD (USD per 1 TOKEN) with its own decimals.
     */
    mapping(bytes32 => AggregatorV3Interface) public priceFeeds;

    /**
     * @notice ROSE/USD price feed (USD per 1 ROSE)
     */
    AggregatorV3Interface public roseUsdFeed;

    /**
     * @notice Token decimal mappings (tokenId => decimals)
     */
    mapping(bytes32 => uint8) public tokenDecimals;

    /**
     * @notice Staleness threshold for price feeds (in seconds)
     */
    uint256 public stalenessThreshold;

    /**
     * @notice Distribution limits and counters
     */
    SapphireTypes.DistributionLimits public limits;

    // ---------------------------------------------------------------------
    // Initialization / Upgradeability
    // ---------------------------------------------------------------------

    /**
     * @notice Initializes the contract with owner, accounting, and distribution limits
     * @param _owner Address to transfer ownership to
     * @param _accounting Accounting contract address
     * @param _limits Distribution limits for payments
     * @param _stalenessThreshold Maximum age for price data in seconds
     * @param _roseUsdFeed Chainlink Aggregator for ROSE/USD
     */
    function initialize(
        address _owner,
        address _accounting,
        SapphireTypes.DistributionLimits memory _limits,
        uint256 _stalenessThreshold,
        address _roseUsdFeed
    ) external initializer {
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
        __Ownable_init(_owner);

        if (_accounting == address(0)) revert ZeroAddress();
        accounting = IAccounting(_accounting);

        stalenessThreshold = _stalenessThreshold;
        limits = _limits;

        if (_roseUsdFeed == address(0)) revert InvalidPriceFeed();
        roseUsdFeed = AggregatorV3Interface(_roseUsdFeed);
    }

    /**
     * @notice Authorizes contract upgrades (UUPS pattern)
     * @param newImplementation New implementation address
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {
        // Only owner can upgrade - implemented by onlyOwner modifier
    }

    // ---------------------------------------------------------------------
    // Admin Functions
    // ---------------------------------------------------------------------

    /**
     * @notice Sets the Accounting contract address
     * @param _accounting New Accounting contract address
     */
    function setAccounting(address _accounting) external onlyOwner {
        if (_accounting == address(0)) revert ZeroAddress();
        address oldAccounting = address(accounting);
        accounting = IAccounting(_accounting);
        emit AccountingUpdated(oldAccounting, _accounting);
    }

    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function setPriceFeed(
        bytes32 tokenId,
        address feed
    ) external override onlyOwner {
        if (feed == address(0)) revert InvalidPriceFeed();
        emit PriceFeedUpdated(tokenId, address(priceFeeds[tokenId]), feed);
        priceFeeds[tokenId] = AggregatorV3Interface(feed);
    }

    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function setRoseUsdFeed(address feed) external override onlyOwner {
        if (feed == address(0)) revert InvalidPriceFeed();
        emit RoseUsdFeedUpdated(address(roseUsdFeed), feed);
        roseUsdFeed = AggregatorV3Interface(feed);
    }

    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function setTokenDecimals(
        bytes32 tokenId,
        uint8 decimals
    ) external override onlyOwner {
        tokenDecimals[tokenId] = decimals;
        emit TokenDecimalsSet(tokenId, decimals);
    }

    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function setStalenessThreshold(
        uint256 threshold
    ) external override onlyOwner {
        stalenessThreshold = threshold;
        emit StalenessThresholdUpdated(threshold);
    }

    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function setDistributionLimits(
        uint128 dailyLimit,
        uint128 perTxLimit,
        bool enabled
    ) external override onlyOwner {
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
    function pause() external override onlyOwner {
        _pause();
    }

    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function unpause() external override onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Core: Inbound (Non-Sapphire -> Sapphire) and Outbound (Sapphire -> Non-Sapphire)
    // ---------------------------------------------------------------------

    /**
     * @notice Processes an inbound deposit from locked funds in Accounting, converts to ROSE, and distributes
     * @dev Called by relayer when user locks non-Sapphire tokens to receive ROSE on Sapphire
     * @param userAddress The user who locked the funds
     * @param tokenId The token identifier from Accounting
     * @param lockIndex The index of the lock in Accounting
     * @param amount The amount of tokens locked
     * @param signature The service (this contract) signature authorizing the transfer
     */
    function processInboundDeposit(
        address userAddress,
        uint256 lockIndex,
        bytes calldata signature // EIP712 of hot wallet that acts as the service (//TODO: be TEE based and part of this contract)
    ) external nonReentrant whenNotPaused {
        // Get lock by lockIndex, get tokenId and amount from there

        // Transfer locked funds from user to this contract in Accounting
        accounting.transferFromLock(
            userAddress,
            address(this), //TODO: make it transfer to multisig vault
            lockIndex,
            amount,
            signature
        );

        // Convert token amount to ROSE
        uint256 roseAmount = _convertToRose(tokenId, amount);

        // Enforce distribution limits
        if (SapphireTypes.wouldExceedLimits(limits, uint128(roseAmount)))
            revert DistributionLimitExceeded();

        // Update limits
        limits = SapphireTypes.updateDistributionLimits(
            limits,
            uint128(roseAmount)
        );

        // Send ROSE to user
        (bool success, ) = payable(userAddress).call{value: roseAmount}("");
        if (!success) revert TransferFailed();

        emit InboundProcessed(userAddress, tokenId, amount, roseAmount);
    }

    /**
     * @notice Processes an outbound withdrawal by accepting ROSE and crediting target token in Accounting
     * @dev Called by user when they want to convert ROSE to tokens on another chain
     * @param targetTokenId The token identifier in Accounting for the target chain/token
     */
    function processOutboundWithdrawal(
        bytes32 targetTokenId
    ) external payable nonReentrant whenNotPaused {
        uint256 roseAmount = msg.value;
        if (roseAmount == 0) revert InvalidAmount();

        // Convert ROSE to target token amount
        uint256 targetAmount = _convertFromRose(targetTokenId, roseAmount);

        // TODO: figure out how this should work? normally its done with EIP712 signatures (So either EOA or TEE based)

        emit OutboundProcessed(
            msg.sender,
            targetTokenId,
            roseAmount,
            targetAmount
        );
    }

    // ---------------------------------------------------------------------
    // Owner Withdrawal
    // ---------------------------------------------------------------------
    /**
     * @inheritdoc ICrossChainPaymaster
     */
    function withdrawRose(
        address to,
        uint256 amount
    ) external override onlyOwner nonReentrant {
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
    function calculateRoseAmount(
        bytes32 tokenId,
        uint256 tokenAmount
    ) external view override returns (uint256) {
        return _convertToRose(tokenId, tokenAmount);
    }

    /**
     * @notice Calculates the token amount for a given ROSE amount
     * @param tokenId The token identifier
     * @param roseAmount The amount of ROSE
     * @return The equivalent token amount
     */
    function calculateTokenAmount(
        bytes32 tokenId,
        uint256 roseAmount
    ) external view returns (uint256) {
        return _convertFromRose(tokenId, roseAmount);
    }

    // ---------------------------------------------------------------------
    // Internal Conversion Logic
    // ---------------------------------------------------------------------

    /**
     * @notice Converts token amount to ROSE amount using Chainlink price feeds
     * @param tokenId The token identifier from Accounting
     * @param tokenAmount The amount of tokens to convert
     * @return roseAmount The equivalent amount in ROSE
     */
    function _convertToRose(
        bytes32 tokenId,
        uint256 tokenAmount
    ) internal view returns (uint256 roseAmount) {
        AggregatorV3Interface tokenUsd = priceFeeds[tokenId];
        if (address(tokenUsd) == address(0))
            revert NoPriceFeedForToken(tokenId);
        if (address(roseUsdFeed) == address(0)) revert InvalidPriceFeed();

        (
            uint80 tRound,
            int256 tPrice,
            ,
            uint256 tUpdated,
            uint80 tAnsweredIn
        ) = tokenUsd.latestRoundData();
        (
            uint80 rRound,
            int256 rPrice,
            ,
            uint256 rUpdated,
            uint80 rAnsweredIn
        ) = roseUsdFeed.latestRoundData();

        // Validate prices & rounds
        if (tPrice <= 0) revert InvalidPrice(tPrice);
        if (rPrice <= 0) revert InvalidPrice(rPrice);
        if (tAnsweredIn < tRound || rAnsweredIn < rRound)
            revert StalePrice(0, 0);
        if (tUpdated == 0 || block.timestamp - tUpdated > stalenessThreshold)
            revert StalePrice(tUpdated, stalenessThreshold);
        if (rUpdated == 0 || block.timestamp - rUpdated > stalenessThreshold)
            revert StalePrice(rUpdated, stalenessThreshold);

        uint8 tokenDec = tokenDecimals[tokenId];
        if (tokenDec == 0) tokenDec = 18;

        uint8 tDec = tokenUsd.decimals();
        uint8 rDec = roseUsdFeed.decimals();

        // roseAmount = tokenAmount * (tokenUsd / roseUsd) adjusted to 18 decimals
        // = tokenAmount * tPrice * 10^rDec * 10^18 / (10^tokenDec * 10^tDec * rPrice)
        uint256 num = Math.mulDiv(tokenAmount, uint256(tPrice), 10 ** tokenDec);
        num = Math.mulDiv(num, 10 ** rDec, 10 ** tDec);
        roseAmount = Math.mulDiv(num, 1e18, uint256(rPrice));
    }

    /**
     * @notice Converts ROSE amount to token amount using Chainlink price feeds
     * @param tokenId The token identifier from Accounting
     * @param roseAmount The amount of ROSE to convert
     * @return tokenAmount The equivalent amount in tokens
     */
    function _convertFromRose(
        bytes32 tokenId,
        uint256 roseAmount
    ) internal view returns (uint256 tokenAmount) {
        // Otherwise use Chainlink feeds
        AggregatorV3Interface tokenUsd = priceFeeds[tokenId];
        if (address(tokenUsd) == address(0))
            revert NoPriceFeedForToken(tokenId);
        if (address(roseUsdFeed) == address(0)) revert InvalidPriceFeed();

        (
            uint80 tRound,
            int256 tPrice,
            ,
            uint256 tUpdated,
            uint80 tAnsweredIn
        ) = tokenUsd.latestRoundData();
        (
            uint80 rRound,
            int256 rPrice,
            ,
            uint256 rUpdated,
            uint80 rAnsweredIn
        ) = roseUsdFeed.latestRoundData();

        // Validate prices & rounds
        if (tPrice <= 0) revert InvalidPrice(tPrice);
        if (rPrice <= 0) revert InvalidPrice(rPrice);
        if (tAnsweredIn < tRound || rAnsweredIn < rRound)
            revert StalePrice(0, 0);
        if (tUpdated == 0 || block.timestamp - tUpdated > stalenessThreshold)
            revert StalePrice(tUpdated, stalenessThreshold);
        if (rUpdated == 0 || block.timestamp - rUpdated > stalenessThreshold)
            revert StalePrice(rUpdated, stalenessThreshold);

        uint8 tokenDec = tokenDecimals[tokenId];
        if (tokenDec == 0) tokenDec = 18;

        uint8 tDec = tokenUsd.decimals();
        uint8 rDec = roseUsdFeed.decimals();

        // tokenAmount = roseAmount * (roseUsd / tokenUsd) adjusted to token decimals
        // = roseAmount * rPrice * 10^tDec * 10^tokenDec / (10^18 * 10^rDec * tPrice)
        uint256 num = Math.mulDiv(roseAmount, uint256(rPrice), 1e18);
        num = Math.mulDiv(num, 10 ** tDec, 10 ** rDec);
        tokenAmount = Math.mulDiv(num, 10 ** tokenDec, uint256(tPrice));
    }

    /// @notice Accepts ROSE funding
    receive() external payable {}
}
