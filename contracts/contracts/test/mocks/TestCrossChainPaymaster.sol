// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../../sapphire/CrossChainPaymaster.sol";

/**
 * @title TestCrossChainPaymaster
 * @notice Test harness that exposes internal functions for unit testing
 * @dev Wraps internal functions to make them publicly accessible
 */
contract TestCrossChainPaymaster is CrossChainPaymaster {
    /**
     * @notice Exposes _convertToRose for testing
     * @param token The token address
     * @param tokenAmount The amount of tokens to convert
     * @return roseAmount The equivalent amount in ROSE
     */
    function exposed_convertToRose(address token, uint256 tokenAmount)
        external
        view
        returns (uint256 roseAmount)
    {
        return _convertToRose(token, tokenAmount);
    }

    /**
     * @notice Exposes _decodePaymentInitiated for testing
     * @param logEntry The RLP-encoded log entry
     * @return vault The vault contract address
     * @return payer The payer address
     * @return recipient The recipient address
     * @return token The token address
     * @return amount The token amount
     * @return paymentId The payment identifier
     */
    function exposed_decodePaymentInitiated(bytes memory logEntry)
        external
        pure
        returns (
            address vault,
            address payer,
            address recipient,
            address token,
            uint256 amount,
            bytes32 paymentId
        )
    {
        return _decodePaymentInitiated(logEntry);
    }

    /**
     * @notice Exposes _decodeRlpUint for testing
     * @param rlp The RLP-encoded bytes
     * @return The decoded uint256 value
     */
    function exposed_decodeRlpUint(bytes memory rlp)
        external
        pure
        returns (uint256)
    {
        return _decodeRlpUint(rlp);
    }
}
