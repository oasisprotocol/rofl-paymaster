// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title BlockHeaderRequester
 * @author Oasis Protocol Foundation
 * @notice Contract that requests block headers for cross-chain verification
 * @dev Emits events that are monitored by the ROFL Header Oracle
 * @dev Should be replaced by a Reporter contract in the future
 */
contract BlockHeaderRequester {
    
    /**
     * @notice Custom error for when a block has already been requested
     */
    error BlockAlreadyRequested(bytes32 requestId);
    
    /**
     * @notice Emitted when a block header is requested
     * @param chainId The chain ID of the source blockchain
     * @param blockNumber The block number being requested
     * @param requester The address that requested the block
     * @param context Additional context data (e.g., message ID for correlation)
     */
    event BlockHeaderRequested(
        uint256 indexed chainId,
        uint256 indexed blockNumber,
        address requester,
        bytes32 context
    );
    
    /**
     * @notice Tracks which blocks have been requested to prevent duplicates
     * @dev Mapping from keccak256(chainId, blockNumber) to boolean
     */
    mapping(bytes32 => bool) public requestedBlocks;
    
    /**
     * @notice Request a block header from a source chain
     * @param chainId The chain ID of the source blockchain
     * @param blockNumber The block number to request
     * @param context Additional context data for the request
     * @dev Reverts if the block has already been requested
     */
    function requestBlockHeader(
        uint256 chainId,
        uint256 blockNumber,
        bytes32 context
    ) external {
        bytes32 requestId = keccak256(abi.encode(chainId, blockNumber));
        
        // Simple deduplication to prevent redundant requests
        require(!requestedBlocks[requestId], BlockAlreadyRequested(requestId));
        
        // Mark as requested
        requestedBlocks[requestId] = true;
        
        // Emit event for the oracle to monitor
        emit BlockHeaderRequested(chainId, blockNumber, msg.sender, context);
    }
    
    /**
     * @notice Check if a specific block has already been requested
     * @param chainId The chain ID of the source blockchain
     * @param blockNumber The block number to check
     * @return bool True if the block has been requested, false otherwise
     */
    function isBlockRequested(
        uint256 chainId, 
        uint256 blockNumber
    ) external view returns (bool) {
        bytes32 requestId = keccak256(abi.encode(chainId, blockNumber));
        return requestedBlocks[requestId];
    }
    
    /**
     * @notice Generate a request ID for a given chain and block
     * @param chainId The chain ID of the source blockchain
     * @param blockNumber The block number
     * @return bytes32 The request ID
     */
    function getRequestId(
        uint256 chainId,
        uint256 blockNumber
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(chainId, blockNumber));
    }
}
