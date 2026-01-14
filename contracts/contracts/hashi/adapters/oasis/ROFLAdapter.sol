// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.20;

import {Subcall} from "@oasisprotocol/sapphire-contracts/contracts/Subcall.sol";
import {BlockHashAdapter} from "../BlockHashAdapter.sol";

/**
 * @title ROFLAdapter
 * @notice Adapter for Oasis ROFL with multi-chain support using per-chain reporters
 * @dev Each chain has its own authorized reporter address, derived from a chain-specific
 *      signing key. This eliminates nonce collisions when multiple oracle instances
 *      submit blocks concurrently for different chains.
 */
contract ROFLAdapter is BlockHashAdapter {
    string public constant PROVIDER = "oasis";

    bytes21 public immutable roflAppID;

    /// @dev Reporter address(0) means chain is unsupported
    mapping(uint256 chainId => address reporter) public chainReporters;

    mapping(uint256 chainId => uint256 lastBlockNumber) public lastStoredBlock;

    error UnauthorizedROFLReporter();
    error UnsupportedChain(uint256 chainId);
    error EmptyBatch();
    error MismatchedInputLengths(uint256 blockNumbersLen, uint256 blockHashesLen);

    event ChainReporterSet(uint256 indexed chainId, address indexed reporter);
    event ChainRemoved(uint256 indexed chainId);
    event BlockHeadersBatchStored(uint256 indexed chainId, uint256 fromBlock, uint256 toBlock, uint256 count);

    modifier onlyROFL() {
        Subcall.roflEnsureAuthorizedOrigin(roflAppID);
        _;
    }

    modifier onlyChainReporter(uint256 chainId) {
        address reporter = chainReporters[chainId];
        if (reporter == address(0)) revert UnsupportedChain(chainId);
        if (msg.sender != reporter) revert UnauthorizedROFLReporter();
        _;
    }

    constructor(bytes21 _roflAppID) {
        roflAppID = _roflAppID;
    }

    /**
     * @notice Stores a block header for a given chain and block number
     * @param chainId The chain ID where the block exists
     * @param blockNumber The block number to store the hash for
     * @param blockHash The block hash to store
     */
    function storeBlockHeader(
        uint256 chainId,
        uint256 blockNumber,
        bytes32 blockHash
    ) external onlyChainReporter(chainId) {
        if (lastStoredBlock[chainId] < blockNumber) {
            lastStoredBlock[chainId] = blockNumber;
        }
        _storeHash(chainId, blockNumber, blockHash);
    }

    /**
     * @notice Stores multiple block headers for a given chain
     * @dev Assumes block numbers are in ascending order
     * @param chainId The chain ID where the blocks exist
     * @param blockNumbers The block numbers to store the hashes for
     * @param blockHashes The block hashes to store
     */
    function storeBlockheaders(
        uint256 chainId,
        uint256[] calldata blockNumbers,
        bytes32[] calldata blockHashes
    ) external onlyChainReporter(chainId) {
        uint256 len = blockNumbers.length;
        if (len == 0) revert EmptyBatch();
        if (len != blockHashes.length) revert MismatchedInputLengths(len, blockHashes.length);

        if (lastStoredBlock[chainId] < blockNumbers[len - 1]) {
            lastStoredBlock[chainId] = blockNumbers[len - 1];
        }

        _storeHashes(chainId, blockNumbers, blockHashes);
        emit BlockHeadersBatchStored(chainId, blockNumbers[0], blockNumbers[len - 1], len);
    }

    /**
     * @notice Sets the authorized reporter for a specific chain
     * @param chainId The chain ID to set the reporter for
     * @param reporter The address authorized to submit block headers
     */
    function setChainReporter(uint256 chainId, address reporter) external onlyROFL {
        chainReporters[chainId] = reporter;
        emit ChainReporterSet(chainId, reporter);
    }

    /**
     * @notice Removes the reporter for a chain, effectively disabling it
     * @param chainId The chain ID to remove
     */
    function removeChainReporter(uint256 chainId) external onlyROFL {
        delete chainReporters[chainId];
        emit ChainRemoved(chainId);
    }

}
