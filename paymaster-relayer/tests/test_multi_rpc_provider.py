"""
Tests for MultiRpcProvider failover logic.

Tests the sequential failover behavior across multiple RPC providers.
"""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from unittest.mock import MagicMock, patch

import pytest
from web3.exceptions import Web3RPCError


class TestMultiRpcProvider:
    """Tests for MultiRpcProvider class."""

    def test_happy_path_first_provider_works(self):
        """First provider works, no failover needed."""
        from paymaster_relayer.utils.multi_rpc_provider import MultiRpcProvider

        urls = ["https://rpc1.example.com", "https://rpc2.example.com"]

        with patch("paymaster_relayer.utils.multi_rpc_provider.Web3") as mock_web3:
            # First provider connects successfully
            mock_instance = MagicMock()
            mock_instance.is_connected.return_value = True
            mock_instance.eth.block_number = 12345
            mock_instance.eth.chain_id = 11155111
            mock_web3.return_value = mock_instance

            provider = MultiRpcProvider(urls)

            assert provider.current_provider_index == 0
            assert provider.is_connected()
            # Should only have created one Web3 instance
            assert mock_web3.call_count == 1

    def test_single_failover_connection_error(self):
        """First provider fails with connection error, second succeeds."""
        from paymaster_relayer.utils.multi_rpc_provider import MultiRpcProvider

        urls = ["https://rpc1.example.com", "https://rpc2.example.com"]

        with patch("paymaster_relayer.utils.multi_rpc_provider.Web3") as mock_web3:
            # First call fails, second succeeds
            mock_fail = MagicMock()
            mock_fail.is_connected.return_value = False

            mock_success = MagicMock()
            mock_success.is_connected.return_value = True
            mock_success.eth.block_number = 12345
            mock_success.eth.chain_id = 11155111

            mock_web3.side_effect = [mock_fail, mock_success]

            provider = MultiRpcProvider(urls)

            # Should have failed over to second provider
            assert provider.current_provider_index == 1
            assert provider.is_connected()

    def test_multiple_failover_first_two_fail(self):
        """First two providers fail, third succeeds."""
        from paymaster_relayer.utils.multi_rpc_provider import MultiRpcProvider

        urls = [
            "https://rpc1.example.com",
            "https://rpc2.example.com",
            "https://rpc3.example.com",
        ]

        with patch("paymaster_relayer.utils.multi_rpc_provider.Web3") as mock_web3:
            mock_fail1 = MagicMock()
            mock_fail1.is_connected.return_value = False

            mock_fail2 = MagicMock()
            mock_fail2.is_connected.return_value = False

            mock_success = MagicMock()
            mock_success.is_connected.return_value = True
            mock_success.eth.block_number = 12345
            mock_success.eth.chain_id = 11155111

            mock_web3.side_effect = [mock_fail1, mock_fail2, mock_success]

            provider = MultiRpcProvider(urls)

            assert provider.current_provider_index == 2
            assert provider.is_connected()

    def test_http_5xx_triggers_immediate_failover(self):
        """HTTP 5xx error triggers immediate failover without retry."""
        from paymaster_relayer.utils.multi_rpc_provider import MultiRpcProvider

        urls = ["https://rpc1.example.com", "https://rpc2.example.com"]

        with patch("paymaster_relayer.utils.multi_rpc_provider.Web3") as mock_web3:
            mock_instance1 = MagicMock()
            mock_instance1.is_connected.return_value = True
            mock_instance1.eth.chain_id = 11155111

            mock_instance2 = MagicMock()
            mock_instance2.is_connected.return_value = True
            mock_instance2.eth.block_number = 12345
            mock_instance2.eth.chain_id = 11155111

            mock_web3.side_effect = [mock_instance1, mock_instance2]

            provider = MultiRpcProvider(urls)

            # Simulate 5xx error on first provider during operation
            def raise_5xx(*args, **kwargs):
                raise Web3RPCError(
                    message="Internal Server Error",
                    rpc_response={
                        "error": {"code": -32000, "message": "Internal error"}
                    },
                )

            mock_instance1.eth.get_block = raise_5xx

            # Execute with failover should switch to second provider
            provider.execute_with_failover(lambda w3: w3.eth.get_block("latest"))

            assert provider.current_provider_index == 1

    def test_rate_limit_429_retry_then_failover(self):
        """Rate limit (429) retries once, then fails over."""
        from paymaster_relayer.utils.multi_rpc_provider import MultiRpcProvider

        urls = ["https://rpc1.example.com", "https://rpc2.example.com"]

        with patch("paymaster_relayer.utils.multi_rpc_provider.Web3") as mock_web3:
            mock_instance1 = MagicMock()
            mock_instance1.is_connected.return_value = True
            mock_instance1.eth.chain_id = 11155111

            mock_instance2 = MagicMock()
            mock_instance2.is_connected.return_value = True
            mock_instance2.eth.block_number = 99999
            mock_instance2.eth.chain_id = 11155111

            mock_web3.side_effect = [mock_instance1, mock_instance2]

            # Track Event.wait calls
            wait_calls = []

            with patch("threading.Event") as mock_event_class:
                mock_event = MagicMock()
                mock_event.is_set.return_value = False

                def track_wait(timeout):
                    wait_calls.append(timeout)
                    return False  # Don't signal shutdown

                mock_event.wait.side_effect = track_wait
                mock_event_class.return_value = mock_event

                provider = MultiRpcProvider(urls)

                # Track call count to simulate retry then fail
                call_count = [0]

                def raise_429(*args, **kwargs):
                    call_count[0] += 1
                    raise Web3RPCError(
                        message="Too Many Requests",
                        rpc_response={
                            "error": {"code": 429, "message": "Rate limited"}
                        },
                    )

                mock_instance1.eth.get_block = raise_429

                # Execute should retry once (with 1s wait), then failover
                provider.execute_with_failover(lambda w3: w3.eth.get_block("latest"))

                # Should have retried once before failover
                assert call_count[0] == 2  # Initial + 1 retry
                assert 1 in wait_calls  # 1 second backoff for rate limit
                assert provider.current_provider_index == 1

    def test_full_cycle_with_exponential_backoff_then_recovery(self):
        """All providers fail, cycle back with exponential backoff, then recover."""
        from paymaster_relayer.utils.multi_rpc_provider import MultiRpcProvider

        urls = ["https://rpc1.example.com", "https://rpc2.example.com"]

        with patch("paymaster_relayer.utils.multi_rpc_provider.Web3") as mock_web3:
            # All providers fail initially, then first succeeds on retry
            mock_fail1 = MagicMock()
            mock_fail1.is_connected.return_value = False

            mock_fail2 = MagicMock()
            mock_fail2.is_connected.return_value = False

            mock_success = MagicMock()
            mock_success.is_connected.return_value = True
            mock_success.eth.block_number = 12345
            mock_success.eth.chain_id = 11155111

            # First cycle: fail, fail. Second cycle: success
            mock_web3.side_effect = [mock_fail1, mock_fail2, mock_success]

            # Mock Event to capture backoff
            backoff_captured = []

            with patch("threading.Event") as mock_event_class:
                mock_event = MagicMock()
                mock_event.is_set.return_value = False

                def capture_wait(timeout):
                    backoff_captured.append(timeout)
                    return False  # Don't signal shutdown

                mock_event.wait.side_effect = capture_wait
                mock_event_class.return_value = mock_event

                provider = MultiRpcProvider(urls)

            # Should have cycled back to first with backoff
            assert provider.current_provider_index == 0
            assert provider.is_connected()

            # Verify exponential backoff was applied (2 seconds for first cycle)
            assert 2 in backoff_captured

    def test_backoff_capped_at_30_seconds(self):
        """Exponential backoff is capped at 30 seconds (new default)."""
        from paymaster_relayer.utils.multi_rpc_provider import MultiRpcProvider

        urls = ["https://rpc1.example.com"]

        with patch("paymaster_relayer.utils.multi_rpc_provider.Web3") as mock_web3:
            # Mock Event.wait to capture backoff values
            backoff_values = []

            def mock_wait(timeout):
                backoff_values.append(timeout)
                return False  # Don't signal shutdown

            # Create many failing mocks, then one success
            fails = [MagicMock() for _ in range(10)]
            for f in fails:
                f.is_connected.return_value = False

            success = MagicMock()
            success.is_connected.return_value = True
            success.eth.block_number = 12345
            success.eth.chain_id = 11155111

            mock_web3.side_effect = [*fails, success]

            # Mock the shutdown event's wait method
            with patch("threading.Event") as mock_event_class:
                mock_event = MagicMock()
                mock_event.is_set.return_value = False
                mock_event.wait.side_effect = mock_wait
                mock_event_class.return_value = mock_event

                MultiRpcProvider(urls)

            # Verify backoff was capped at 30 seconds
            # Backoff sequence: 2, 4, 8, 16, 30, 30, 30, 30, 30, 30
            assert max(backoff_values) <= 30
            # Verify we hit the cap multiple times
            assert backoff_values.count(30) >= 5

    def test_current_url_property(self):
        """current_url property returns the current provider URL."""
        from paymaster_relayer.utils.multi_rpc_provider import MultiRpcProvider

        urls = ["https://rpc1.example.com", "https://rpc2.example.com"]

        with patch("paymaster_relayer.utils.multi_rpc_provider.Web3") as mock_web3:
            mock_instance = MagicMock()
            mock_instance.is_connected.return_value = True
            mock_instance.eth.chain_id = 11155111
            mock_web3.return_value = mock_instance

            provider = MultiRpcProvider(urls)

            assert provider.current_url == "https://rpc1.example.com"

    def test_get_web3_returns_current_instance(self):
        """get_web3() returns the current Web3 instance."""
        from paymaster_relayer.utils.multi_rpc_provider import MultiRpcProvider

        urls = ["https://rpc1.example.com"]

        with patch("paymaster_relayer.utils.multi_rpc_provider.Web3") as mock_web3:
            mock_instance = MagicMock()
            mock_instance.is_connected.return_value = True
            mock_instance.eth.chain_id = 11155111
            mock_web3.return_value = mock_instance

            provider = MultiRpcProvider(urls)

            assert provider.get_web3() is mock_instance

    def test_shutdown_interrupts_init_retry(self):
        """Shutdown signal interrupts infinite retry during initialization."""
        from paymaster_relayer.utils.multi_rpc_provider import MultiRpcProvider

        urls = ["https://rpc1.example.com"]

        with patch("paymaster_relayer.utils.multi_rpc_provider.Web3") as mock_web3:
            # All providers fail
            mock_fail = MagicMock()
            mock_fail.is_connected.return_value = False
            mock_web3.return_value = mock_fail

            # Mock Event to simulate shutdown after first backoff
            with patch("threading.Event") as mock_event_class:
                mock_event = MagicMock()
                shutdown_after_first_wait = [False]

                def wait_then_shutdown(timeout):
                    if not shutdown_after_first_wait[0]:
                        shutdown_after_first_wait[0] = True
                        return False  # First wait - don't signal shutdown yet
                    return True  # Subsequent waits - signal shutdown

                mock_event.is_set.return_value = False
                mock_event.wait.side_effect = wait_then_shutdown
                mock_event_class.return_value = mock_event

                with pytest.raises(
                    Exception, match="Shutdown requested during initialization"
                ):
                    MultiRpcProvider(urls)

    def test_shutdown_interrupts_runtime_failover(self):
        """Shutdown signal interrupts infinite retry during runtime failover."""
        from paymaster_relayer.utils.multi_rpc_provider import MultiRpcProvider

        urls = ["https://rpc1.example.com", "https://rpc2.example.com"]

        with patch("paymaster_relayer.utils.multi_rpc_provider.Web3") as mock_web3:
            # First provider connects successfully
            mock_success = MagicMock()
            mock_success.is_connected.return_value = True
            mock_success.eth.chain_id = 11155111

            # Failover providers all fail
            mock_fail = MagicMock()
            mock_fail.is_connected.return_value = False

            mock_web3.side_effect = [mock_success, mock_fail, mock_fail]

            with patch("threading.Event") as mock_event_class:
                mock_event = MagicMock()
                failover_wait_count = [0]

                def wait_then_shutdown(timeout):
                    if failover_wait_count[0] < 1:
                        failover_wait_count[0] += 1
                        return False  # First wait during failover - continue
                    return True  # Second wait - signal shutdown

                mock_event.is_set.return_value = False
                mock_event.wait.side_effect = wait_then_shutdown
                mock_event_class.return_value = mock_event

                provider = MultiRpcProvider(urls)

                # Trigger failover by raising retryable error
                mock_success.eth.get_block.side_effect = Web3RPCError(
                    message="Server error",
                    rpc_response={
                        "error": {"code": -32000, "message": "Internal error"}
                    },
                )

                with pytest.raises(
                    Exception, match="Shutdown requested during failover"
                ):
                    provider.execute_with_failover(
                        lambda w3: w3.eth.get_block("latest")
                    )

    def test_progressive_logging_at_thresholds(self):
        """Progressive ERROR logs appear at cycle thresholds 10, 50, 100."""
        from paymaster_relayer.utils.multi_rpc_provider import MultiRpcProvider

        urls = ["https://rpc1.example.com"]

        with (
            patch("paymaster_relayer.utils.multi_rpc_provider.Web3") as mock_web3,
            patch("paymaster_relayer.utils.multi_rpc_provider.logger") as mock_logger,
            patch("threading.Event") as mock_event_class,
        ):
            # Create failing providers for many cycles
            fails = [MagicMock() for _ in range(15)]
            for f in fails:
                f.is_connected.return_value = False

            # Then success
            success = MagicMock()
            success.is_connected.return_value = True
            success.eth.chain_id = 11155111
            mock_web3.side_effect = [*fails, success]

            # Mock Event to allow 15 cycles
            mock_event = MagicMock()
            mock_event.is_set.return_value = False
            mock_event.wait.return_value = False  # Never shutdown
            mock_event_class.return_value = mock_event

            MultiRpcProvider(urls)

            # Check that ERROR logs appeared at threshold 10
            error_calls = [
                call
                for call in mock_logger.error.call_args_list
                if "10 cycles" in str(call)
            ]
            assert len(error_calls) >= 1

    def test_execute_with_failover_infinite_retry(self):
        """execute_with_failover retries infinitely until success."""
        from paymaster_relayer.utils.multi_rpc_provider import MultiRpcProvider

        urls = ["https://rpc1.example.com", "https://rpc2.example.com"]

        with patch("paymaster_relayer.utils.multi_rpc_provider.Web3") as mock_web3:
            # Initial connection succeeds
            mock_instance1 = MagicMock()
            mock_instance1.is_connected.return_value = True
            mock_instance1.eth.chain_id = 11155111

            # Failover instances all fail initially
            mock_fail = MagicMock()
            mock_fail.is_connected.return_value = False

            # Eventually one succeeds
            mock_instance2 = MagicMock()
            mock_instance2.is_connected.return_value = True
            mock_instance2.eth.chain_id = 11155111
            mock_instance2.eth.get_block.return_value = {"number": 99999}

            # Sequence: init success, 5 failover fails, then failover success
            mock_web3.side_effect = [
                mock_instance1,
                mock_fail,
                mock_fail,
                mock_fail,
                mock_fail,
                mock_fail,
                mock_instance2,
            ]

            with patch("threading.Event") as mock_event_class:
                mock_event = MagicMock()
                mock_event.is_set.return_value = False
                mock_event.wait.return_value = False  # Never shutdown
                mock_event_class.return_value = mock_event

                provider = MultiRpcProvider(urls)

                # Trigger failover by raising retryable error multiple times
                call_count = [0]

                def raise_error_then_succeed(*args, **kwargs):
                    call_count[0] += 1
                    if call_count[0] <= 5:
                        raise Web3RPCError(
                            message="Server error",
                            rpc_response={
                                "error": {"code": -32000, "message": "Internal error"}
                            },
                        )
                    return {"number": 99999}

                mock_instance1.eth.get_block = raise_error_then_succeed

                # Should eventually succeed after many retries
                result = provider.execute_with_failover(
                    lambda w3: w3.eth.get_block("latest")
                )
                assert result["number"] == 99999

    def test_shutdown_interrupts_rate_limit_retry(self):
        """Shutdown signal interrupts rate limit retry sleep."""
        from paymaster_relayer.utils.multi_rpc_provider import MultiRpcProvider

        urls = ["https://rpc1.example.com"]

        with patch("paymaster_relayer.utils.multi_rpc_provider.Web3") as mock_web3:
            mock_instance = MagicMock()
            mock_instance.is_connected.return_value = True
            mock_instance.eth.chain_id = 11155111
            mock_web3.return_value = mock_instance

            with patch("threading.Event") as mock_event_class:
                mock_event = MagicMock()
                wait_count = [0]

                def wait_then_shutdown(timeout):
                    wait_count[0] += 1
                    return wait_count[0] == 1  # First wait - signal shutdown

                mock_event.is_set.return_value = False
                mock_event.wait.side_effect = wait_then_shutdown
                mock_event_class.return_value = mock_event

                provider = MultiRpcProvider(urls)

                # Trigger rate limit error
                mock_instance.eth.get_block.side_effect = Web3RPCError(
                    message="Too Many Requests",
                    rpc_response={"error": {"code": 429, "message": "Rate limited"}},
                )

                with pytest.raises(
                    Exception, match="Shutdown requested during rate limit retry"
                ):
                    provider.execute_with_failover(
                        lambda w3: w3.eth.get_block("latest")
                    )
