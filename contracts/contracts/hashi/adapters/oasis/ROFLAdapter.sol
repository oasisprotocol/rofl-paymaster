// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.20;

import { Subcall } from "@oasisprotocol/sapphire-contracts/contracts/Subcall.sol";
import { BlockHashAdapter } from "../BlockHashAdapter.sol";

/**
 * @title ROFLAdapter
 * @notice Adapter for Oasis Sapphire ROFL (Runtime OFf-chain Logic) applications
 */
contract ROFLAdapter is BlockHashAdapter {
    string public constant PROVIDER = "oasis";

    bytes21 public immutable roflAppID;
    address public ROFL_ORACLE;
    uint256 public immutable SOURCE_CHAIN_ID;

    error UnauthorizedROFLOracle();

    constructor(bytes21 _roflAppID, uint256 _sourceChainId) {
        roflAppID = _roflAppID;
        SOURCE_CHAIN_ID = _sourceChainId;
    }

    /**
     * @notice Stores a block header for a given chain and block number
     * @dev Only callable by the authorized ROFL application through Subcall authorization
     * @param chainId The chain ID where the block exists
     * @param blockNumber The block number to store the hash for
     * @param blockHash The block hash to store
     */
    function storeBlockHeader(uint256 chainId, uint256 blockNumber, bytes32 blockHash) external {
        // Verify that the caller is authorized oracle address
        if (msg.sender != ROFL_ORACLE) {
            revert UnauthorizedROFLOracle();
        }

        _storeHash(chainId, blockNumber, blockHash);
    }

    function setOracle(address oracle) external {
        Subcall.roflEnsureAuthorizedOrigin(roflAppID);
        ROFL_ORACLE = oracle;
    }
}
