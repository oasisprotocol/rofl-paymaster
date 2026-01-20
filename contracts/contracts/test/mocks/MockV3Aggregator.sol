// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/**
 * @title MockV3Aggregator
 * @notice Mock Chainlink price feed for testing
 * @dev Simulates AggregatorV3Interface with configurable price, decimals, and staleness
 */
contract MockV3Aggregator is AggregatorV3Interface {
    uint8 public override decimals;
    int256 public latestAnswer;
    uint256 public latestTimestamp;
    uint80 public latestRound;

    bool public shouldRevert;
    bool public shouldReturnStaleRound;

    constructor(uint8 _decimals, int256 _initialAnswer) {
        decimals = _decimals;
        latestAnswer = _initialAnswer;
        latestTimestamp = block.timestamp;
        latestRound = 1;
        shouldRevert = false;
        shouldReturnStaleRound = false;
    }

    function updateAnswer(int256 _answer) external {
        latestAnswer = _answer;
        latestTimestamp = block.timestamp;
        latestRound++;
    }

    function updateRoundData(
        uint80 _roundId,
        int256 _answer,
        uint256 _timestamp,
        uint256 _startedAt
    ) external {
        latestRound = _roundId;
        latestAnswer = _answer;
        latestTimestamp = _timestamp;
    }

    function setDecimals(uint8 _decimals) external {
        decimals = _decimals;
    }

    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    function setShouldReturnStaleRound(bool _stale) external {
        shouldReturnStaleRound = _stale;
    }

    function setLatestTimestamp(uint256 _timestamp) external {
        latestTimestamp = _timestamp;
    }

    function getRoundData(uint80 _roundId)
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        require(!shouldRevert, "MockV3Aggregator: revert requested");
        return (
            _roundId,
            latestAnswer,
            latestTimestamp,
            latestTimestamp,
            shouldReturnStaleRound ? _roundId - 1 : _roundId
        );
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        require(!shouldRevert, "MockV3Aggregator: revert requested");
        return (
            latestRound,
            latestAnswer,
            latestTimestamp,
            latestTimestamp,
            shouldReturnStaleRound ? latestRound - 1 : latestRound
        );
    }

    function description() external pure override returns (string memory) {
        return "MockV3Aggregator";
    }

    function version() external pure override returns (uint256) {
        return 0;
    }
}
