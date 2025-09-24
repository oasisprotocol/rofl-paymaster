// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { RemoteTypes } from "../libraries/RemoteTypes.sol";

/**
 * @title IPaymasterVault
 * @author Oasis Protocol Foundation
 * @notice Interface for the PaymasterVault contract on Base chain
 * @dev Handles multi-token ERC20 deposits for cross-chain ROSE distribution
 */
interface IPaymasterVault {
    // --------------------
    // Events
    // --------------------
    /**
     * @notice Emitted when a user deposits tokens into the vault
     * @param depositId Unique identifier for the deposit
     * @param depositor Address that made the deposit
     * @param token Address of the deposited ERC20 token
     * @param amount Amount of tokens deposited
     * @param recipient Recipient address on Oasis Sapphire chain
     * @param blockNumber Block number when deposit occurred (indexed for range queries)
     */
    event TokenDeposited(
        uint256 depositId,
        address indexed depositor,
        address indexed token,
        uint256 amount,
        address indexed recipient,
        uint256 blockNumber
    );

    /**
     * @notice Emitted when a new ERC20 token is added to supported tokens
     * @param token Address of the newly supported token
     * @param minDepositAmount Minimum deposit amount for this token
     * @param maxDepositAmount Maximum deposit amount for this token
     */
    event TokenAdded(
        address indexed token,
        uint256 minDepositAmount,
        uint256 maxDepositAmount
    );

    /**
     * @notice Emitted when a token's configuration is updated
     * @param token Address of the token being updated
     * @param minDepositAmount New minimum deposit amount
     * @param maxDepositAmount New maximum deposit amount
     * @param enabled Whether the token is enabled for deposits
     */
    event TokenConfigUpdated(
        address indexed token,
        uint256 minDepositAmount,
        uint256 maxDepositAmount,
        bool enabled
    );

    /**
     * @notice Emitted when deposits are paused
     * @param account Address that triggered the pause
     */
    event DepositsPaused(address account);

    /**
     * @notice Emitted when deposits are unpaused
     * @param account Address that triggered the unpause
     */
    event DepositsUnpaused(address account);

    /**
     * @notice Emitted when the owner withdraws accumulated tokens from the vault
     * @param token Address of the withdrawn ERC20 token
     * @param to Recipient address receiving the tokens
     * @param amount Amount of tokens withdrawn
     * @param operator Address that initiated the withdrawal (owner)
     */
    event TokenWithdrawn(
        address indexed token,
        address indexed to,
        uint256 amount,
        address indexed operator
    );

    /**
     * @notice Emitted for Hashi proofing of a payment initiation.
     * @dev Three indexed topics for efficient filtering; unindexed data carries amount and context.
     * @param payer Address depositing on the remote chain
     * @param recipient Recipient address on Sapphire
     * @param token ERC20 token deposited
     * @param amount Amount of tokens deposited (unindexed, in token decimals)
     * @param paymentId Correlation identifier used as header request context
     */
    event PaymentInitiated(
        address indexed payer,
        address indexed recipient,
        address indexed token,
        uint256 amount,
        bytes32 paymentId
    );

    // --------------------
    // Errors
    // --------------------
    error UnsupportedToken();
    error AmountBelowMinimum();
    error AmountAboveMaximum();
    error InvalidRecipient();
    error CircuitBreakerTriggered();
    error ZeroAddress();
    error InvalidAmount();
    error InsufficientBalance(uint256 available, uint256 required);

    /**
     * @notice Deposits ERC20 tokens into the vault for cross-chain ROSE distribution
     * @dev MUST use nonReentrant modifier to prevent reentrancy attacks
     * @dev MUST use whenNotPaused modifier to respect pause state
     * @dev MUST update state before external calls (Checks-Effects-Interactions pattern)
     * @dev MUST validate against ERC777 callback reentrancy
     * @param token The ERC20 token to deposit (must be supported)
     * @param amount Amount of tokens to deposit
     * @param recipient Recipient address on Oasis Sapphire chain
     * @return depositId Unique identifier for this deposit
     */
    function deposit(
        IERC20 token,
        uint256 amount,
        address recipient
    ) external returns (uint256 depositId);

    /**
     * @notice Checks if a token is supported for deposits
     * @param token The ERC20 token to check
     * @return supported True if the token is supported
     */
    function isTokenSupported(IERC20 token) external view returns (bool supported);

    /**
     * @notice Gets the configuration for a supported token
     * @param token The ERC20 token to query
     * @return minAmount Minimum deposit amount
     * @return maxAmount Maximum deposit amount
     * @return enabled Whether deposits are enabled for this token
     */
    function getTokenConfig(IERC20 token) external view returns (
        uint256 minAmount,
        uint256 maxAmount,
        bool enabled
    );

    /**
     * @notice Gets the total amount deposited for a specific token
     * @param token The ERC20 token to query
     * @return totalDeposited Total amount deposited for this token
     */
    function getTotalDeposited(IERC20 token) external view returns (uint256 totalDeposited);

    /**
     * @notice Gets deposit information by ID
     * @param depositId The deposit ID to query
     * @return depositor Address that made the deposit
     * @return token Address of the deposited token
     * @return amount Amount deposited
     * @return recipient Recipient address on Sapphire
     * @return blockNumber Block number of the deposit
     * @return timestamp Timestamp of the deposit
     */
    function getDeposit(uint256 depositId) external view returns (
        address depositor,
        address token,
        uint256 amount,
        address recipient,
        uint256 blockNumber,
        uint256 timestamp
    );

    // --------------------
    // Admin: Asset configuration
    // --------------------
    /**
     * @notice Add or update a supported token configuration
     * @param token The token to configure
     * @param cfg The configuration for the token
     */
    function setTokenConfig(IERC20 token, RemoteTypes.AssetConfig calldata cfg) external;

    /**
     * @notice Enable or disable deposits for a token without changing amounts
     * @param token The token to enable or disable
     * @param enabled Whether to enable or disable deposits
     */
    function setTokenEnabled(IERC20 token, bool enabled) external;

    // --------------------
    // Admin: Circuit breaker controls
    // --------------------
    /**
     * @notice Set the daily deposit limit for a token
     * @param token The token to set the limit for
     * @param newLimit The new daily limit amount
     */
    function setTokenDailyLimit(IERC20 token, uint128 newLimit) external;

    /**
     * @notice Enable or disable the circuit breaker for a token
     * @param token The token to enable or disable the circuit breaker for
     * @param enabled Whether to enable or disable the circuit breaker
     */
    function setTokenCircuitBreakerEnabled(IERC20 token, bool enabled) external;

    /**
     * @notice Get the circuit breaker state for a token
     * @param token The token to get the circuit breaker for
     * @return The circuit breaker state
     */
    function getTokenCircuitBreaker(IERC20 token) external view returns (RemoteTypes.CircuitBreaker memory);

    /**
     * @notice Pauses all deposit operations (emergency use only)
     * @dev MUST be restricted to EMERGENCY_STOP_ROLE or owner
     * @dev Emits DepositsPaused event
     */
    function pauseDeposits() external;

    /**
     * @notice Unpauses deposit operations
     * @dev MUST be restricted to EMERGENCY_STOP_ROLE or owner
     * @dev Emits DepositsUnpaused event
     */
    function unpauseDeposits() external;

    /**
     * @notice Checks if deposits are currently paused
     * @return paused True if deposits are paused
     */
    function depositsArePaused() external view returns (bool paused);

    /**
     * @notice Withdraw accumulated ERC20 tokens to a treasury address
     * @dev MUST be restricted to owner; SHOULD use nonReentrant in implementation
     * @param token ERC20 token to withdraw
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function withdrawToken(
        IERC20 token,
        address to,
        uint256 amount
    ) external;
}
