// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ReceiptProof } from "../../hashi/prover/HashiProverStructs.sol";
import { SapphireTypes } from "../libraries/SapphireTypes.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/**
 * @title ICrossChainPaymaster
 * @author Oasis Protocol Foundation
 * @notice Interface for the Sapphire CrossChainPaymaster using Hashi receipt proofs
 */
interface ICrossChainPaymaster {
    /**
     * @notice Emitted after a verified payment distributes ROSE on Sapphire
     * @param paymentId Deterministic ID: keccak(chainId, vault, blockNumber, txIndex, logIndex)
     * @param roseAmount Amount of ROSE distributed
     */
    event PaymentProcessed(bytes32 indexed paymentId, uint256 roseAmount);

    /**
     * @notice Emitted when a price feed is updated for a token
     * @param token The token address
     * @param oldFeed Previous price feed address
     * @param newFeed New price feed address
     */
    event PriceFeedUpdated(address indexed token, address indexed oldFeed, address indexed newFeed);

    /**
     * @notice Emitted when the ROSE/USD feed is updated
     * @param oldFeed Previous ROSE/USD feed address
     * @param newFeed New ROSE/USD feed address
     */
    event RoseUsdFeedUpdated(address indexed oldFeed, address indexed newFeed);

    /**
     * @notice Emitted when token decimals are set
     * @param token The token address
     * @param decimals The number of decimals for the token
     */
    event TokenDecimalsSet(address indexed token, uint8 decimals);

    /**
     * @notice Emitted when a chain configuration is updated
     * @param chainId The chain ID being configured
     * @param config The new chain configuration
     */
    event ChainConfigUpdated(uint256 indexed chainId, SapphireTypes.ChainConfig config);

    /**
     * @notice Emitted when vault authorization status changes
     * @param chainId The chain ID
     * @param vault The vault address
     * @param authorized New authorization status
     */
    event VaultAuthorizationUpdated(uint256 indexed chainId, address indexed vault, bool authorized);

    /**
     * @notice Emitted when distribution limits are updated
     * @param dailyLimit New daily distribution limit
     * @param perTxLimit New per-transaction limit
     * @param enabled Whether limits are enabled
     */
    event DistributionLimitsUpdated(
        uint128 dailyLimit,
        uint128 perTxLimit,
        bool enabled
    );

    /**
     * @notice Emitted when ROSE is withdrawn from the contract
     * @param to Recipient address
     * @param amount Amount of ROSE withdrawn
     * @param caller Address that initiated the withdrawal
     */
    event RoseWithdrawn(address indexed to, uint256 amount, address indexed caller);

    // Errors
    error InvalidPriceFeed();
    error NoPriceFeedForToken(address token);
    error StalePrice(uint256 timestamp, uint256 threshold);
    error InvalidPrice(int256 price);
    error ChainDisabled(uint256 chainId);
    error VaultNotAuthorized(uint256 chainId, address vault);
    error InvalidEvent();
    error DuplicatePayment(bytes32 paymentId);
    error DistributionLimitExceeded();
    error TransferFailed();
    error ZeroAddress();
    error InvalidAmount();
    error InsufficientBalance(uint256 available, uint256 required);

    /**
     * @notice Process a PaymentInitiated event proof and distribute ROSE (permissionless)
     * @dev Security enforced by Hashi proof verification, chain/vault auth, limits, and replay protection
     * @param proof ReceiptProof consumed by HashiProver
     */
    function processPayment(ReceiptProof calldata proof) external;

    /**
     * @notice Checks if a paymentId has already been processed
     * @param paymentId keccak(chainId, vault, blockNumber, txIndex, logIndex)
     * @return processed True if already processed
     */
    function isPaymentProcessed(bytes32 paymentId) external view returns (bool processed);

    /**
     * @notice Checks if a paymentId has already been processed
     * @param paymentId The payment ID to check
     * @return processed True if already processed
     */
    function processedPayments(bytes32 paymentId) external view returns (bool processed);

    /**
     * @notice Converts a token amount to ROSE via oracle
     * @param token Source chain token address
     * @param tokenAmount Amount of tokens
     * @return roseAmount Equivalent in ROSE
     */
    function calculateRoseAmount(address token, uint256 tokenAmount) external view returns (uint256 roseAmount);

    /**
     * @notice Returns the price feed for a given token
     * @param token The token address
     * @return The AggregatorV3Interface contract address for the token
     */
    function priceFeeds(address token) external view returns (AggregatorV3Interface);

    /**
     * @notice Returns the ROSE/USD price feed
     */
    function roseUsdFeed() external view returns (AggregatorV3Interface);

    /**
     * @notice Returns the decimals for a given token
     * @param token The token address
     * @return The number of decimals for the token
     */
    function tokenDecimals(address token) external view returns (uint8);

    /**
     * @notice Returns the staleness threshold for price feeds
     * @return The staleness threshold in seconds
     */
    function stalenessThreshold() external view returns (uint256);

    /**
     * @notice Checks if a vault is authorized for a given chain
     * @param chainId The chain ID to check
     * @param vault The vault address to check
     * @return True if the vault is authorized for the chain
     */
    function isAuthorizedVault(uint256 chainId, address vault) external view returns (bool);

    /**
     * @notice Sets the price feed for a specific token
     * @param token The token address
     * @param feed The Chainlink price feed address
     */
    function setPriceFeed(address token, address feed) external;

    /**
     * @notice Sets the ROSE/USD price feed
     * @param feed The Chainlink price feed address for ROSE/USD
     */
    function setRoseUsdFeed(address feed) external;

    /**
     * @notice Sets the decimals for a specific token
     * @param token The token address
     * @param decimals The number of decimals for the token
     */
    function setTokenDecimals(address token, uint8 decimals) external;

    /**
     * @notice Sets the staleness threshold for price feeds
     * @param threshold The staleness threshold in seconds
     */
    function setStalenessThreshold(uint256 threshold) external;

    /**
     * @notice Sets configuration for a specific chain
     * @param chainId The chain ID to configure
     * @param config The chain configuration
     */
    function setChainConfig(uint256 chainId, SapphireTypes.ChainConfig calldata config) external;

    /**
     * @notice Sets vault authorization status for a chain
     * @param chainId The chain ID
     * @param vault The vault address
     * @param authorized Whether the vault should be authorized
     */
    function setVaultAuthorization(uint256 chainId, address vault, bool authorized) external;

    /**
     * @notice Sets distribution limits for payments
     * @param dailyLimit Maximum ROSE distributable per day
     * @param perTxLimit Maximum ROSE distributable per transaction
     * @param enabled Whether limits should be enforced
     */
    function setDistributionLimits(uint128 dailyLimit, uint128 perTxLimit, bool enabled) external;

    /**
     * @notice Withdraws ROSE from the contract to a specified address
     * @param to The recipient address
     * @param amount The amount of ROSE to withdraw
     */
    function withdrawRose(address to, uint256 amount) external;

    /**
     * @notice Pause/unpause controls
     */
    function pause() external;

    /**
     * @notice Unpauses the contract operations
     */
    function unpause() external;
}
