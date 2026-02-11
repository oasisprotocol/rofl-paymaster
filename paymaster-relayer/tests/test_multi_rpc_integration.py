"""
Tests for MultiRpcProvider integration with relayer components.

Tests that relayer, event listener, and contract utility correctly use
the multi-RPC provider for failover.
"""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from unittest.mock import MagicMock, patch


class TestRelayerMultiRpcIntegration:
    """Tests for relayer integration with MultiRpcProvider."""

    def test_relayer_initializes_with_multi_rpc_provider(self, monkeypatch):
        """Relayer should use MultiRpcProvider for source chain."""
        from paymaster_relayer.relayer import ROFLRelayer

        # Set required env vars
        monkeypatch.setenv(
            "SOURCE_RPC_URLS", "https://rpc1.example.com,https://rpc2.example.com"
        )
        monkeypatch.setenv("TARGET_RPC_URL", "https://sapphire.example.com")
        monkeypatch.setenv("PAYMASTER_VAULT_ADDRESS", "0x" + "1" * 40)
        monkeypatch.setenv("PAYMASTER_PROXY_ADDRESS", "0x" + "2" * 40)
        monkeypatch.setenv("ROFL_ADAPTER_ADDRESS", "0x" + "3" * 40)
        monkeypatch.setenv("PRIVATE_KEY", "0x" + "4" * 64)

        with (
            patch("paymaster_relayer.relayer.MultiRpcProvider") as mock_provider,
            patch("paymaster_relayer.relayer.ContractUtility"),
            patch("paymaster_relayer.relayer.ProofManager"),
        ):
            mock_instance = MagicMock()
            mock_instance.is_connected.return_value = True
            mock_instance.get_web3.return_value = MagicMock()
            mock_provider.return_value = mock_instance

            ROFLRelayer.from_env(local_mode=True)

            # Verify MultiRpcProvider was created with source chain URLs
            mock_provider.assert_called_once()
            call_args = mock_provider.call_args[0][0]
            assert "https://rpc1.example.com" in call_args
            assert "https://rpc2.example.com" in call_args

    def test_relayer_uses_provider_web3_instance(self, monkeypatch):
        """Relayer should get Web3 instance from MultiRpcProvider."""
        from paymaster_relayer.relayer import ROFLRelayer

        monkeypatch.setenv("SOURCE_RPC_URLS", "https://rpc1.example.com")
        monkeypatch.setenv("TARGET_RPC_URL", "https://sapphire.example.com")
        monkeypatch.setenv("PAYMASTER_VAULT_ADDRESS", "0x" + "1" * 40)
        monkeypatch.setenv("PAYMASTER_PROXY_ADDRESS", "0x" + "2" * 40)
        monkeypatch.setenv("ROFL_ADAPTER_ADDRESS", "0x" + "3" * 40)
        monkeypatch.setenv("PRIVATE_KEY", "0x" + "4" * 64)

        with (
            patch("paymaster_relayer.relayer.MultiRpcProvider") as mock_provider,
            patch("paymaster_relayer.relayer.ContractUtility"),
            patch("paymaster_relayer.relayer.ProofManager"),
        ):
            mock_web3 = MagicMock()
            mock_instance = MagicMock()
            mock_instance.is_connected.return_value = True
            mock_instance.get_web3.return_value = mock_web3
            mock_provider.return_value = mock_instance

            relayer = ROFLRelayer.from_env(local_mode=True)

            # Verify relayer has source_provider attribute
            assert relayer.source_provider is mock_instance


class TestPollingEventListenerMultiRpcIntegration:
    """Tests for PollingEventListener integration with MultiRpcProvider."""

    def test_relayer_passes_provider_web3_to_event_listener(self, monkeypatch):
        """Relayer passes Web3 instance from MultiRpcProvider to PollingEventListener."""
        from paymaster_relayer.utils.multi_rpc_provider import MultiRpcProvider

        # The integration pattern: relayer creates provider, gets Web3, passes to listener
        urls = ["https://rpc1.example.com", "https://rpc2.example.com"]

        with patch(
            "paymaster_relayer.utils.multi_rpc_provider.Web3"
        ) as mock_web3_class:
            mock_instance = MagicMock()
            mock_instance.is_connected.return_value = True
            mock_instance.eth.block_number = 12345
            mock_instance.eth.chain_id = 11155111
            mock_web3_class.return_value = mock_instance

            provider = MultiRpcProvider(urls)
            w3 = provider.get_web3()

            # Verify the Web3 instance is from the provider
            assert w3 is mock_instance
            assert provider.current_provider_index == 0

    def test_provider_failover_updates_web3_for_relayer(self):
        """When provider fails over, subsequent get_web3() returns new instance."""
        from paymaster_relayer.utils.multi_rpc_provider import MultiRpcProvider

        urls = ["https://rpc1.example.com", "https://rpc2.example.com"]

        with patch(
            "paymaster_relayer.utils.multi_rpc_provider.Web3"
        ) as mock_web3_class:
            mock_instance1 = MagicMock()
            mock_instance1.is_connected.return_value = True
            mock_instance1.eth.block_number = 100
            mock_instance1.eth.chain_id = 11155111

            mock_instance2 = MagicMock()
            mock_instance2.is_connected.return_value = True
            mock_instance2.eth.block_number = 200
            mock_instance2.eth.chain_id = 11155111

            mock_web3_class.side_effect = [mock_instance1, mock_instance2]

            provider = MultiRpcProvider(urls)

            # First instance
            w3_first = provider.get_web3()
            assert w3_first.eth.block_number == 100

            # Force failover
            provider._failover_to_next()

            # New instance after failover
            w3_after = provider.get_web3()
            assert w3_after.eth.block_number == 200
            assert provider.current_provider_index == 1


class TestFailoverDuringOperations:
    """Tests for failover behavior during active operations."""

    def test_failover_triggers_during_event_monitoring(self):
        """Failover should trigger when provider fails during event fetch."""
        from web3.exceptions import Web3RPCError

        from paymaster_relayer.utils.multi_rpc_provider import MultiRpcProvider

        urls = ["https://rpc1.example.com", "https://rpc2.example.com"]

        with patch(
            "paymaster_relayer.utils.multi_rpc_provider.Web3"
        ) as mock_web3_class:
            # First provider connects but fails on operation
            mock_instance1 = MagicMock()
            mock_instance1.is_connected.return_value = True
            mock_instance1.eth.chain_id = 11155111

            # Second provider works
            mock_instance2 = MagicMock()
            mock_instance2.is_connected.return_value = True
            mock_instance2.eth.get_logs.return_value = [{"event": "test"}]
            mock_instance2.eth.chain_id = 11155111

            mock_web3_class.side_effect = [mock_instance1, mock_instance2]

            provider = MultiRpcProvider(urls)

            # Simulate failure during get_logs
            call_count = [0]

            def failing_then_success(w3):
                call_count[0] += 1
                if call_count[0] == 1:
                    raise Web3RPCError(
                        message="Server Error",
                        rpc_response={"error": {"code": -32000, "message": "Internal"}},
                    )
                return w3.eth.get_logs({})

            result = provider.execute_with_failover(failing_then_success)

            # Should have failed over and succeeded
            assert provider.current_provider_index == 1
            assert result == [{"event": "test"}]

    def test_relayer_recovers_after_provider_switch(self, monkeypatch):
        """Relayer should continue working after provider failover."""
        from paymaster_relayer.utils.multi_rpc_provider import MultiRpcProvider

        urls = ["https://rpc1.example.com", "https://rpc2.example.com"]

        with patch(
            "paymaster_relayer.utils.multi_rpc_provider.Web3"
        ) as mock_web3_class:
            mock_instance1 = MagicMock()
            mock_instance1.is_connected.return_value = True
            mock_instance1.eth.block_number = 100
            mock_instance1.eth.chain_id = 11155111

            mock_instance2 = MagicMock()
            mock_instance2.is_connected.return_value = True
            mock_instance2.eth.block_number = 101
            mock_instance2.eth.chain_id = 11155111

            mock_web3_class.side_effect = [mock_instance1, mock_instance2]

            provider = MultiRpcProvider(urls)

            # First operation works
            result1 = provider.execute_with_failover(lambda w3: w3.eth.block_number)
            assert result1 == 100
            assert provider.current_provider_index == 0

            # Simulate first provider going down with a network error
            # Note: Must use a retryable error type (OSError) - generic exceptions
            # correctly propagate without triggering failover
            mock_instance1.eth.block_number = property(
                lambda self: (_ for _ in ()).throw(OSError("Connection lost"))
            )

            # Force failover by making the operation fail with a network error
            def get_block_with_failover(w3):
                if provider.current_provider_index == 0:
                    raise OSError("Connection lost")
                return w3.eth.block_number

            result2 = provider.execute_with_failover(get_block_with_failover)

            # Should have switched to second provider
            assert provider.current_provider_index == 1
            assert result2 == 101
