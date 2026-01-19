// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title RemoteTypes
 * @author Oasis Protocol Foundation
 * @notice Data structures and types for remote EVM chain (Base) contracts
 * @dev Gas-optimized struct packing for efficient storage
 */
library RemoteTypes {
    /**
     * @notice Configuration for supported ERC20 tokens
     * @dev Packed into single storage slot (256 bits total)
     * - enabled: 1 bit
     * - decimals: 8 bits  
     * - minAmount: 96 bits (up to ~79B tokens with 18 decimals)
     * - maxAmount: 96 bits (up to ~79B tokens with 18 decimals)
     * - reserved: 55 bits (for future expansion)
     */
    struct AssetConfig {
        bool enabled;           // 1 bit - whether deposits are enabled
        uint8 decimals;         // 8 bits - token decimals (0-255)
        uint96 minAmount;       // 96 bits - minimum deposit amount
        uint96 maxAmount;       // 96 bits - maximum deposit amount
        // Total: 1 + 8 + 96 + 96 = 201 bits (55 bits remaining in slot)
    }

    /**
     * @notice Individual deposit data
     */
    struct DepositData {
        uint32 sourceChainId;   // 32 bits - source chain ID for replay protection
        address depositor;      // 160 bits - who made the deposit
        IERC20 token;          // 160 bits - which token was deposited
        uint256 amount;        // 256 bits - amount deposited
        address recipient;     // 160 bits - recipient on Sapphire chain
        uint256 blockNumber;   // 256 bits - block number of deposit
        uint256 timestamp;     // 256 bits - timestamp of deposit
        uint256 nonce;         // 256 bits - user-specific nonce for uniqueness
    }

    /**
     * @notice Circuit breaker configuration for daily limits
     */
    struct CircuitBreaker {
        uint128 dailyLimit;    // 128 bits - daily volume limit
        uint128 currentVolume; // 128 bits - current daily volume
        uint32 lastResetDay;   // 32 bits - last reset day (days since epoch)
        bool enabled;          // 1 bit - whether circuit breaker is active
        // Total: 128 + 128 + 32 + 1 = 289 bits (requires 2 storage slots)
    }

    /**
     * @notice Global vault statistics
     * @dev Used for monitoring and analytics
     */
    struct VaultStats {
        uint256 totalDeposits;    // Total number of deposits processed
        uint256 totalTokenTypes;  // Number of supported token types
        uint256 totalVolume;      // Total volume across all tokens (in USD equivalent)
    }

    /**
     * @notice Maximum safe amount to prevent system lockup
     * @dev ~39 billion tokens with 18 decimals (half of uint96 max)
     */
    uint96 internal constant MAX_SAFE_AMOUNT = type(uint96).max / 2;

    /**
     * @notice Custom errors for asset configuration validation
     */
    error InvalidMinAmount();
    error InvalidMaxAmount();
    error InvalidDecimals();
    error MinAmountExceedsMax();
    error AmountExceedsSafeLimit();

    /**
     * @notice Validates asset configuration parameters with comprehensive checks
     * @param config The asset configuration to validate
     * @return valid True if configuration is valid
     */
    function validateAssetConfig(AssetConfig memory config) internal pure returns (bool valid) {
        if (config.minAmount == 0) revert InvalidMinAmount();
        if (config.maxAmount == 0) revert InvalidMaxAmount();
        if (config.decimals > 18) revert InvalidDecimals();
        if (config.maxAmount <= config.minAmount) revert MinAmountExceedsMax();
        if (config.maxAmount > MAX_SAFE_AMOUNT) revert AmountExceedsSafeLimit();
        
        return true;
    }

    /**
     * @notice Checks if circuit breaker should trigger
     * @param breaker Current circuit breaker state
     * @param newAmount Amount to be added
     * @return shouldTrigger True if circuit breaker should activate
     */
    function shouldTriggerCircuitBreaker(
        CircuitBreaker memory breaker,
        uint128 newAmount
    ) internal view returns (bool shouldTrigger) {
        if (!breaker.enabled) return false;
        
        uint32 currentDay = uint32(block.timestamp / 86400); // seconds per day
        
        // Reset if new day
        if (currentDay > breaker.lastResetDay) {
            return newAmount > breaker.dailyLimit;
        }
        
        return (breaker.currentVolume + newAmount) > breaker.dailyLimit;
    }

    /**
     * @notice Updates circuit breaker state after a deposit
     * @param breaker Current circuit breaker state
     * @param amount Amount being deposited
     * @return updated Updated circuit breaker state
     */
    function updateCircuitBreaker(
        CircuitBreaker memory breaker,
        uint128 amount
    ) internal view returns (CircuitBreaker memory updated) {
        uint32 currentDay = uint32(block.timestamp / 86400);
        
        if (currentDay > breaker.lastResetDay) {
            // New day - reset volume
            updated = CircuitBreaker({
                dailyLimit: breaker.dailyLimit,
                currentVolume: amount,
                lastResetDay: currentDay,
                enabled: breaker.enabled
            });
        } else {
            // Same day - add to current volume (overflow protected by Solidity 0.8+)
            updated = breaker;
            updated.currentVolume += amount;
        }
    }

    /**
     * @notice Generates unique deposit ID with replay protection
     * @dev Uses chain ID and user nonce to prevent collisions and replay attacks
     * @param depositor Address making the deposit
     * @param token Token being deposited
     * @param amount Amount being deposited
     * @param nonce User-specific nonce for uniqueness
     * @param blockNumber Current block number
     * @return depositId Unique deposit identifier
     */
    function generateDepositId(
        address depositor,
        IERC20 token,
        uint256 amount,
        uint256 nonce,
        uint256 blockNumber
    ) internal view returns (uint256 depositId) {
        return uint256(keccak256(abi.encodePacked(
            block.chainid,      // Chain ID for replay protection
            depositor,
            address(token),
            amount,
            nonce,
            blockNumber,
            block.timestamp
        )));
    }
}
