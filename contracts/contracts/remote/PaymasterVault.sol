// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import {IPaymasterVault} from "./interfaces/IPaymasterVault.sol";
import {BlockHeaderRequester} from "./BlockHeaderRequester.sol";
import {RemoteTypes} from "./libraries/RemoteTypes.sol";

/**
 * @title PaymasterVault
 * @author Oasis Protocol Foundation
 * @notice Remote-chain (Base) vault that accepts ERC20 deposits for cross-chain ROSE distribution on Sapphire.
 *         Emits Hashi-verifiable event and requests block header publication via BlockHeaderRequester.
 */
contract PaymasterVault is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    IPaymasterVault
{
    using SafeERC20 for IERC20;

    // Events are declared in the interface (including PaymentInitiated)

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    // Supported asset configuration
    mapping(IERC20 => RemoteTypes.AssetConfig) private _assetConfigs;

    // Aggregate volume per token
    mapping(IERC20 => uint256) private _totalDeposited;

    // Deposits by generated ID
    mapping(uint256 => RemoteTypes.DepositData) private _deposits;

    // Per-user nonce used in depositId entropy
    mapping(address => uint256) private _nonces;

    // Circuit breaker state per token (daily limit per asset)
    mapping(IERC20 => RemoteTypes.CircuitBreaker) private _tokenCircuitBreaker;

    /**
     * @notice Address of the helper that emits header requests for Hashi oracles
     */
    BlockHeaderRequester public blockHeaderRequester;

    // Errors are declared in the interface

    // ---------------------------------------------------------------------
    // Initialization / Upgradeability
    // ---------------------------------------------------------------------

    /**
     * @notice Initialize the upgradeable vault
     * @param _owner Owner address
     * @param _blockHeaderRequester Address of BlockHeaderRequester
     */
    function initialize(
        address _owner,
        address _blockHeaderRequester
    ) external initializer {
        __Ownable_init(_owner);
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        blockHeaderRequester = BlockHeaderRequester(_blockHeaderRequester);
    }

    /**
     * @notice Authorizes contract upgrades (UUPS pattern)
     * @param newImplementation New implementation address
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ---------------------------------------------------------------------
    // Views (IPaymasterVault)
    // ---------------------------------------------------------------------

    /**
     * @inheritdoc IPaymasterVault
     */
    function isTokenSupported(IERC20 token) external view override returns (bool supported) {
        return _assetConfigs[token].enabled;
    }

    /**
     * @inheritdoc IPaymasterVault
     */
    function getTokenConfig(IERC20 token) external view override returns (
        uint256 minAmount,
        uint256 maxAmount,
        bool enabled
    ) {
        RemoteTypes.AssetConfig memory cfg = _assetConfigs[token];
        return (uint256(cfg.minAmount), uint256(cfg.maxAmount), cfg.enabled);
    }

    /**
     * @inheritdoc IPaymasterVault
     */
    function getTotalDeposited(IERC20 token) external view override returns (uint256 totalDeposited) {
        return _totalDeposited[token];
    }

    /**
     * @inheritdoc IPaymasterVault
     */
    function getDeposit(uint256 depositId) external view override returns (
        address depositor,
        address token,
        uint256 amount,
        address recipient,
        uint256 blockNumber,
        uint256 timestamp
    ) {
        RemoteTypes.DepositData storage d = _deposits[depositId];
        return (d.depositor, address(d.token), d.amount, d.recipient, d.blockNumber, d.timestamp);
    }

    /**
     * @inheritdoc IPaymasterVault
     */
    function depositsArePaused() external view override returns (bool paused_) {
        return paused();
    }

    // ---------------------------------------------------------------------
    // Admin: Asset configuration (CRUD)
    // ---------------------------------------------------------------------

    /**
     * @notice Add or update a supported token configuration
     * @dev Validates using RemoteTypes.validateAssetConfig()
     * @param token The ERC20 token address to configure
     * @param cfg The asset configuration struct
     */
    function setTokenConfig(IERC20 token, RemoteTypes.AssetConfig calldata cfg) external onlyOwner override {
        // Validate config (reverts on invalid)
        RemoteTypes.validateAssetConfig(cfg);

        bool existed = _assetConfigs[token].minAmount != 0 || _assetConfigs[token].maxAmount != 0 || _assetConfigs[token].enabled;
        _assetConfigs[token] = cfg;

        if (existed) {
            emit TokenConfigUpdated(address(token), uint256(cfg.minAmount), uint256(cfg.maxAmount), cfg.enabled);
        } else {
            emit TokenAdded(address(token), uint256(cfg.minAmount), uint256(cfg.maxAmount));
            if (!cfg.enabled) {
                emit TokenConfigUpdated(address(token), uint256(cfg.minAmount), uint256(cfg.maxAmount), false);
            }
        }
    }

    /**
     * @notice Enable or disable deposits for a token without changing amounts
     * @param token The ERC20 token address
     * @param enabled Whether deposits should be enabled
     */
    function setTokenEnabled(IERC20 token, bool enabled) external onlyOwner override {
        RemoteTypes.AssetConfig memory cfg = _assetConfigs[token];
        require(
            cfg.minAmount != 0 || cfg.maxAmount != 0 || cfg.enabled,
            UnsupportedToken()
        );
        _assetConfigs[token].enabled = enabled;
        emit TokenConfigUpdated(address(token), uint256(cfg.minAmount), uint256(cfg.maxAmount), enabled);
    }

    // ---------------------------------------------------------------------
    // Admin: Circuit breaker controls (per token)
    // ---------------------------------------------------------------------

    /**
     * @notice Set the daily deposit limit for a token
     * @param token The ERC20 token address
     * @param newLimit The new daily limit amount
     */
    function setTokenDailyLimit(IERC20 token, uint128 newLimit) external onlyOwner override {
        RemoteTypes.CircuitBreaker storage br = _tokenCircuitBreaker[token];
        // If this is the first time configuring, seed lastResetDay
        if (br.lastResetDay == 0) {
            br.lastResetDay = uint32(block.timestamp / 1 days);
        }
        br.dailyLimit = newLimit;
    }

    /**
     * @notice Enable or disable the circuit breaker for a token
     * @param token The ERC20 token address
     * @param enabled Whether the circuit breaker should be enabled
     */
    function setTokenCircuitBreakerEnabled(IERC20 token, bool enabled) external onlyOwner override {
        RemoteTypes.CircuitBreaker storage br = _tokenCircuitBreaker[token];
        if (br.lastResetDay == 0) {
            br.lastResetDay = uint32(block.timestamp / 1 days);
        }
        br.enabled = enabled;
    }

    /**
     * @notice Get the circuit breaker state for a token
     * @param token The ERC20 token address
     * @return The circuit breaker configuration
     */
    function getTokenCircuitBreaker(IERC20 token) external view override returns (RemoteTypes.CircuitBreaker memory) {
        return _tokenCircuitBreaker[token];
    }

    // ---------------------------------------------------------------------
    // Pausing (IPaymasterVault)
    // ---------------------------------------------------------------------

    /**
     * @notice Pause all deposit operations
     */
    function pauseDeposits() external override onlyOwner {
        _pause();
        emit DepositsPaused(msg.sender);
    }

    /**
     * @notice Unpause deposit operations
     */
    function unpauseDeposits() external override onlyOwner {
        _unpause();
        emit DepositsUnpaused(msg.sender);
    }

    // ---------------------------------------------------------------------
    // Core: Deposit
    // ---------------------------------------------------------------------

    /**
     * @inheritdoc IPaymasterVault
     */
    function deposit(
        IERC20 token,
        uint256 amount,
        address recipient
    ) external override nonReentrant whenNotPaused returns (uint256 depositId) {
        require(recipient != address(0), InvalidRecipient());

        // Validate token support and bounds
        RemoteTypes.AssetConfig memory cfg = _assetConfigs[token];
        require(cfg.enabled, UnsupportedToken());
        require(amount >= uint256(cfg.minAmount), AmountBelowMinimum());
        require(amount <= uint256(cfg.maxAmount), AmountAboveMaximum());

        // Enforce circuit breaker (daily limit) per token
        RemoteTypes.CircuitBreaker memory br = _tokenCircuitBreaker[token];
        require(!RemoteTypes.shouldTriggerCircuitBreaker(br, uint128(amount)), CircuitBreakerTriggered());

        uint256 userNonce = _nonces[msg.sender];
        _nonces[msg.sender] = userNonce + 1;

        uint256 currentBlock = block.number;
        depositId = RemoteTypes.generateDepositId(msg.sender, token, amount, userNonce, currentBlock);

        _deposits[depositId] = RemoteTypes.DepositData({
            sourceChainId: uint32(block.chainid),
            depositor: msg.sender,
            token: token,
            amount: amount,
            recipient: recipient,
            blockNumber: currentBlock,
            timestamp: block.timestamp,
            nonce: userNonce
        });

        // Update aggregate totals and circuit breaker counters
        _totalDeposited[token] += amount;
        br = RemoteTypes.updateCircuitBreaker(br, uint128(amount));
        _tokenCircuitBreaker[token] = br;

        // Interactions: pull funds from user
        token.safeTransferFrom(msg.sender, address(this), amount);

        // Emit canonical interface event for indexing/reporting
        emit TokenDeposited(depositId, msg.sender, address(token), amount, recipient, currentBlock);

        // Hashi-friendly minimal event
        bytes32 paymentId = _computeContextPaymentId(address(this), currentBlock, depositId);
        emit PaymentInitiated(msg.sender, recipient, address(token), amount, paymentId);

        // Request block header for the current block to be available in ShoyuBashi
        try blockHeaderRequester.requestBlockHeader(block.chainid, currentBlock, paymentId) {
        } catch {
            // Already requested or requester reverted; deposit remains valid
        }

        return depositId;
    }

    /**
     * @notice Owner withdrawal of accumulated ERC20 tokens to treasury
     * @dev nonReentrant to guard against ERC777-style callbacks
     * @param token The ERC20 token to withdraw
     * @param to The recipient address
     * @param amount The amount to withdraw
     */
    function withdrawToken(
        IERC20 token,
        address to,
        uint256 amount
    ) external override onlyOwner nonReentrant {
        require(to != address(0), ZeroAddress());
        require(amount != 0, InvalidAmount());
        uint256 bal = token.balanceOf(address(this));
        require(amount <= bal, InsufficientBalance(bal, amount));
        token.safeTransfer(to, amount);
        emit TokenWithdrawn(address(token), to, amount, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Utilities
    // ---------------------------------------------------------------------

    /**
     * @notice Deterministic paymentId derivation used across the system (Hashi-compatible).
     * @dev Off-chain systems compute this using log metadata. Provided here for reference/testing.
     * @param chainId The source chain ID
     * @param vault The vault contract address
     * @param blockNumber The block number
     * @param txIndex The transaction index in the block
     * @param logIndex The log index in the transaction
     * @return The deterministic payment ID
     */
    function derivePaymentId(
        uint256 chainId,
        address vault,
        uint256 blockNumber,
        uint256 txIndex,
        uint256 logIndex
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(chainId, vault, blockNumber, txIndex, logIndex));
    }

    /**
     * @notice Computes payment ID for the current transaction context
     * @param vault The vault address
     * @param blockNumber The block number
     * @param depositId The deposit ID
     * @return The computed payment ID
     */
    function _computeContextPaymentId(
        address vault,
        uint256 blockNumber,
        uint256 depositId
    ) internal view returns (bytes32) {
        // Context identifier for correlating header requests; not used for on-chain proofing
        return keccak256(abi.encode(block.chainid, vault, blockNumber, depositId));
    }
}
