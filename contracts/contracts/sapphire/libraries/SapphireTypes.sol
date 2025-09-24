// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title SapphireTypes
 * @author Oasis Protocol Foundation
 * @notice Data structures and types for Sapphire chain contracts
 * @dev Optimized for Oasis Sapphire privacy features and gas efficiency
 */
library SapphireTypes {
    /**
     * @notice Configuration for supported source chains
     * @dev Packed into single storage slot (256 bits total)
     */
    struct ChainConfig {
        uint32 chainId;         // 32 bits - chain ID (up to 4.2B)
        bool enabled;           // 1 bit - whether chain is enabled
        uint32 confirmations;   // 32 bits - required confirmations
        uint32 blockTime;       // 32 bits - average block time in seconds
        uint128 maxAmount;      // 128 bits - max amount per transaction
        // Total: 32 + 1 + 32 + 32 + 128 = 225 bits (31 bits remaining)
    }

    /**
     * @notice ROSE distribution limits and circuit breaker
     * @dev Gas-optimized packing for distribution controls
     */
    struct DistributionLimits {
        uint128 dailyLimit;     // 128 bits - daily ROSE distribution limit
        uint128 currentDaily;   // 128 bits - current daily distribution
        uint128 perTxLimit;      // 128 bits - per-transaction limit
        uint32 lastResetDay;    // 32 bits - last reset day
        bool enabled;           // 1 bit - whether limits are enforced
        // Total: 128 + 128 + 128 + 32 + 1 = 417 bits (requires 3 slots)
    }

    /**
     * @notice Custom errors for validation
     */
    error InvalidChainId();
    error DepositAlreadyClaimed();
    error UnauthorizedChain();

    /**
     * @notice Validates chain configuration with comprehensive checks
     * @param config Chain configuration to validate
     * @return valid True if configuration is valid
     */
    function validateChainConfig(ChainConfig memory config) internal pure returns (bool valid) {
        if (config.chainId == 0) revert InvalidChainId();
        if (config.confirmations == 0) return false;
        if (config.blockTime == 0) return false;
        if (config.maxAmount == 0) return false;
        return true;
    }

    /**
     * @notice Validates that a deposit is from an authorized chain
     * @param sourceChainId Chain ID from the deposit
     * @param authorizedChains Array of authorized chain configurations
     * @return valid True if chain is authorized
     */
    function validateSourceChain(
        uint32 sourceChainId,
        ChainConfig[] memory authorizedChains
    ) internal pure returns (bool valid) {
        if (sourceChainId == 0) revert InvalidChainId();
        
        for (uint256 i = 0; i < authorizedChains.length; i++) {
            if (authorizedChains[i].chainId == sourceChainId && authorizedChains[i].enabled) {
                return true;
            }
        }
        revert UnauthorizedChain();
    }

    /**
     * @notice Updates distribution limits after ROSE distribution
     * @param limits Current limits
     * @param amount Amount being distributed
     * @return updated Updated limits
     */
    function updateDistributionLimits(
        DistributionLimits memory limits,
        uint128 amount
    ) internal view returns (DistributionLimits memory updated) {
        uint32 currentDay = uint32(block.timestamp / 86400);
        
        if (currentDay > limits.lastResetDay) {
            // New day - reset daily counter
            updated = DistributionLimits({
                dailyLimit: limits.dailyLimit,
                currentDaily: amount,
                perTxLimit: limits.perTxLimit,
                lastResetDay: currentDay,
                enabled: limits.enabled
            });
        } else {
            // Same day - add to current daily amount
            updated = limits;
            updated.currentDaily += amount;
        }
    }

    /**
     * @notice Checks if distribution would exceed limits
     * @param limits Current distribution limits
     * @param amount Amount to be distributed
     * @return wouldExceed True if limits would be exceeded
     */
    function wouldExceedLimits(
        DistributionLimits memory limits,
        uint128 amount
    ) internal view returns (bool wouldExceed) {
        if (!limits.enabled) return false;
        
        // Check per-transaction limit
        if (amount > limits.perTxLimit) return true;
        
        uint32 currentDay = uint32(block.timestamp / 86400);
        
        // Check daily limit
        if (currentDay > limits.lastResetDay) {
            // New day - only check against daily limit
            return amount > limits.dailyLimit;
        } else {
            // Same day - check against remaining daily limit
            return (limits.currentDaily + amount) > limits.dailyLimit;
        }
    }
}
