"""
Unit tests for retry logic in proof_manager.py, event_processor.py, and relayer.py.

Tests cover:
- FuturePriceTimestamp error retry behavior
- DuplicatePayment error handling
- retry_pending_payments method
- _periodic_retry_pending task exception handling
"""

import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from paymaster_relayer.event_processor import EventProcessor
from paymaster_relayer.models import PaymentEvent
from paymaster_relayer.proof_manager import (
    DUPLICATE_PAYMENT_ERROR_B64,
    FUTURE_PRICE_MAX_RETRIES,
    FUTURE_PRICE_RETRY_DELAY,
    FUTURE_PRICE_TIMESTAMP_ERROR_B64,
    ProofManager,
)

# Valid Ethereum addresses for testing
TEST_ADDRESS = "0x0000000000000000000000000000000000000001"
TEST_PAYMASTER = "0x0000000000000000000000000000000000000002"
TEST_TX_HASH = "0x" + "ab" * 32


class TestFuturePriceTimestampRetry:
    """Test FuturePriceTimestamp error retry logic in ProofManager."""

    @pytest.fixture
    def mock_rofl_util(self):
        """Create a mock ROFL utility."""
        return AsyncMock()

    @pytest.fixture
    def mock_contract_util(self):
        """Create a mock contract utility."""
        util = MagicMock()
        util.w3 = MagicMock()
        util.w3.eth.gas_price = 1000000000
        return util

    @pytest.fixture
    def mock_w3_source(self):
        """Create a mock Web3 source."""
        return MagicMock()

    @pytest.fixture
    def proof_manager(self, mock_w3_source, mock_contract_util, mock_rofl_util):
        """Create a ProofManager with mocked dependencies."""
        return ProofManager(
            w3_source=mock_w3_source,
            contract_util=mock_contract_util,
            rofl_util=mock_rofl_util,
        )

    @pytest.mark.asyncio
    async def test_future_price_timestamp_retry_succeeds_on_second_attempt(
        self, proof_manager, mock_rofl_util
    ):
        """Test that FuturePriceTimestamp error triggers retry and succeeds."""
        # First call raises FuturePriceTimestamp, second succeeds
        mock_rofl_util.submit_tx.side_effect = [
            Exception(f"revert: {FUTURE_PRICE_TIMESTAMP_ERROR_B64}"),
            True,
        ]

        # Mock generate_proof to return valid proof data
        with patch.object(
            proof_manager, "generate_proof", new_callable=AsyncMock
        ) as mock_gen:
            mock_gen.return_value = [1, 2, "0x", 0, [], [], 0, 0]

            # Mock contract loading
            with patch.object(
                proof_manager.contract_util, "get_contract"
            ) as mock_contract:
                mock_contract_instance = MagicMock()
                mock_contract_instance.functions.processPayment.return_value.build_transaction.return_value = {
                    "data": "0x"
                }
                mock_contract.return_value = mock_contract_instance

                # Patch sleep to speed up test
                with patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
                    payment = PaymentEvent(
                        tx_hash=TEST_TX_HASH,
                        block_number=100,
                        payer=TEST_ADDRESS,
                        recipient=TEST_ADDRESS,
                        token=TEST_ADDRESS,
                        amount=1000,
                    )

                    result = await proof_manager.process_payment_event(
                        payment, TEST_PAYMASTER
                    )

                    # Should have slept once before retry
                    mock_sleep.assert_called_once_with(FUTURE_PRICE_RETRY_DELAY)

                    # Should have called submit_tx twice
                    assert mock_rofl_util.submit_tx.call_count == 2

                    # Should return success
                    assert result == "ROFL_SUBMITTED"

    @pytest.mark.asyncio
    async def test_future_price_timestamp_fails_after_max_retries(
        self, proof_manager, mock_rofl_util
    ):
        """Test that FuturePriceTimestamp error fails after max retries."""
        # All calls raise FuturePriceTimestamp
        mock_rofl_util.submit_tx.side_effect = Exception(
            f"revert: {FUTURE_PRICE_TIMESTAMP_ERROR_B64}"
        )

        with patch.object(
            proof_manager, "generate_proof", new_callable=AsyncMock
        ) as mock_gen:
            mock_gen.return_value = [1, 2, "0x", 0, [], [], 0, 0]

            with patch.object(
                proof_manager.contract_util, "get_contract"
            ) as mock_contract:
                mock_contract_instance = MagicMock()
                mock_contract_instance.functions.processPayment.return_value.build_transaction.return_value = {
                    "data": "0x"
                }
                mock_contract.return_value = mock_contract_instance

                with patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
                    payment = PaymentEvent(
                        tx_hash=TEST_TX_HASH,
                        block_number=100,
                        payer=TEST_ADDRESS,
                        recipient=TEST_ADDRESS,
                        token=TEST_ADDRESS,
                        amount=1000,
                    )

                    result = await proof_manager.process_payment_event(
                        payment, TEST_PAYMASTER
                    )

                    # Should have slept (max_retries - 1) times
                    assert mock_sleep.call_count == FUTURE_PRICE_MAX_RETRIES - 1

                    # Should have tried max_retries times
                    assert mock_rofl_util.submit_tx.call_count == FUTURE_PRICE_MAX_RETRIES

                    # Should return None (failure)
                    assert result is None


class TestDuplicatePaymentHandling:
    """Test DuplicatePayment error handling in ProofManager."""

    @pytest.fixture
    def proof_manager(self):
        """Create a ProofManager with mocked dependencies."""
        mock_rofl_util = AsyncMock()
        mock_contract_util = MagicMock()
        mock_contract_util.w3 = MagicMock()
        mock_contract_util.w3.eth.gas_price = 1000000000
        mock_w3_source = MagicMock()

        return ProofManager(
            w3_source=mock_w3_source,
            contract_util=mock_contract_util,
            rofl_util=mock_rofl_util,
        )

    @pytest.mark.asyncio
    async def test_duplicate_payment_returns_already_processed(self, proof_manager):
        """Test that DuplicatePayment error returns ALREADY_PROCESSED."""
        proof_manager.rofl_util.submit_tx.side_effect = Exception(
            f"revert: {DUPLICATE_PAYMENT_ERROR_B64}"
        )

        with patch.object(
            proof_manager, "generate_proof", new_callable=AsyncMock
        ) as mock_gen:
            mock_gen.return_value = [1, 2, "0x", 0, [], [], 0, 0]

            with patch.object(
                proof_manager.contract_util, "get_contract"
            ) as mock_contract:
                mock_contract_instance = MagicMock()
                mock_contract_instance.functions.processPayment.return_value.build_transaction.return_value = {
                    "data": "0x"
                }
                mock_contract.return_value = mock_contract_instance

                payment = PaymentEvent(
                    tx_hash=TEST_TX_HASH,
                    block_number=100,
                    payer=TEST_ADDRESS,
                    recipient=TEST_ADDRESS,
                    token=TEST_ADDRESS,
                    amount=1000,
                )

                result = await proof_manager.process_payment_event(
                    payment, TEST_PAYMASTER
                )

                # Should return ALREADY_PROCESSED
                assert result == "ALREADY_PROCESSED"

                # Should NOT retry (only 1 call)
                assert proof_manager.rofl_util.submit_tx.call_count == 1


class TestRetryPendingPayments:
    """Test retry_pending_payments method in EventProcessor."""

    @pytest.fixture
    def processor(self):
        """Create an EventProcessor with mocked dependencies."""
        proc = EventProcessor()
        proc.proof_manager = MagicMock()
        proc.config = MagicMock()
        proc.config.target.paymaster_address = TEST_PAYMASTER
        return proc

    @pytest.mark.asyncio
    async def test_retry_pending_payments_retries_when_hash_stored(self, processor):
        """Test that pending payments are retried when their hashes are stored."""
        payment = PaymentEvent(
            tx_hash=TEST_TX_HASH,
            block_number=100,
            payer=TEST_ADDRESS,
            recipient=TEST_ADDRESS,
            token=TEST_ADDRESS,
            amount=1000,
        )

        # Add payment to pending
        processor._add_to_pending(payment)

        # Mark block hash as stored (stored_hashes is OrderedDict[int, str])
        processor.stored_hashes[100] = "0xblockhash"

        # Mock process_matched_payment to return True (success)
        with patch.object(
            processor, "process_matched_payment", new_callable=AsyncMock
        ) as mock_process:
            mock_process.return_value = True

            retried = await processor.retry_pending_payments()

            # Should have retried 1 payment
            assert retried == 1

            # Should have called process_matched_payment
            mock_process.assert_called_once_with(payment)

    @pytest.mark.asyncio
    async def test_retry_pending_payments_skips_when_hash_not_stored(self, processor):
        """Test that pending payments are NOT retried when hashes are not stored."""
        payment = PaymentEvent(
            tx_hash=TEST_TX_HASH,
            block_number=100,
            payer=TEST_ADDRESS,
            recipient=TEST_ADDRESS,
            token=TEST_ADDRESS,
            amount=1000,
        )

        # Add payment to pending
        processor._add_to_pending(payment)

        # Hash NOT stored (stored_hashes is empty)

        with patch.object(
            processor, "process_matched_payment", new_callable=AsyncMock
        ) as mock_process:
            retried = await processor.retry_pending_payments()

            # Should have retried 0 payments
            assert retried == 0

            # Should NOT have called process_matched_payment
            mock_process.assert_not_called()

    @pytest.mark.asyncio
    async def test_retry_pending_payments_returns_zero_without_config(self, processor):
        """Test that retry returns 0 when config is not set."""
        processor.config = None

        payment = PaymentEvent(
            tx_hash=TEST_TX_HASH,
            block_number=100,
            payer=TEST_ADDRESS,
            recipient=TEST_ADDRESS,
            token=TEST_ADDRESS,
            amount=1000,
        )
        processor._add_to_pending(payment)
        processor.stored_hashes[100] = "0xblockhash"

        retried = await processor.retry_pending_payments()

        assert retried == 0

    @pytest.mark.asyncio
    async def test_retry_pending_payments_counts_successful_retries(self, processor):
        """Test that only successful retries are counted."""
        payment1 = PaymentEvent(
            tx_hash=TEST_TX_HASH,
            block_number=100,
            payer=TEST_ADDRESS,
            recipient=TEST_ADDRESS,
            token=TEST_ADDRESS,
            amount=1000,
        )
        payment2 = PaymentEvent(
            tx_hash="0x" + "cd" * 32,
            block_number=100,
            payer=TEST_ADDRESS,
            recipient=TEST_ADDRESS,
            token=TEST_ADDRESS,
            amount=2000,
        )

        processor._add_to_pending(payment1)
        processor._add_to_pending(payment2)
        processor.stored_hashes[100] = "0xblockhash"

        # First succeeds, second fails
        with patch.object(
            processor, "process_matched_payment", new_callable=AsyncMock
        ) as mock_process:
            mock_process.side_effect = [True, False]

            retried = await processor.retry_pending_payments()

            # Should report 1 successful retry
            assert retried == 1
            assert mock_process.call_count == 2


class TestPeriodicRetryPending:
    """Test _periodic_retry_pending task in ROFLRelayer."""

    @pytest.mark.asyncio
    async def test_periodic_retry_calls_retry_pending_payments(self):
        """Test that periodic retry task calls retry_pending_payments."""
        from paymaster_relayer.relayer import ROFLRelayer

        # Create a minimal relayer with mocked components
        with patch.object(ROFLRelayer, "__init__", lambda x: None):
            relayer = ROFLRelayer()
            relayer.running = True
            relayer.RETRY_PENDING_INTERVAL = 0.1  # Fast interval for testing
            relayer.event_processor = MagicMock()
            relayer.event_processor.retry_pending_payments = AsyncMock(return_value=2)

            # Run the task briefly then stop
            async def stop_after_delay():
                await asyncio.sleep(0.25)
                relayer.running = False

            # Start both tasks
            stop_task = asyncio.create_task(stop_after_delay())
            retry_task = asyncio.create_task(relayer._periodic_retry_pending())

            await asyncio.gather(stop_task, retry_task, return_exceptions=True)

            # Should have called retry_pending_payments at least once
            assert relayer.event_processor.retry_pending_payments.call_count >= 1


class TestErrorSelectorConstants:
    """Test that error selector constants are correctly defined."""

    def test_future_price_timestamp_error_b64_is_string(self):
        """Test that FUTURE_PRICE_TIMESTAMP_ERROR_B64 is a non-empty string."""
        assert isinstance(FUTURE_PRICE_TIMESTAMP_ERROR_B64, str)
        assert len(FUTURE_PRICE_TIMESTAMP_ERROR_B64) > 0

    def test_duplicate_payment_error_b64_is_string(self):
        """Test that DUPLICATE_PAYMENT_ERROR_B64 is a non-empty string."""
        assert isinstance(DUPLICATE_PAYMENT_ERROR_B64, str)
        assert len(DUPLICATE_PAYMENT_ERROR_B64) > 0

    def test_retry_constants_are_reasonable(self):
        """Test that retry constants have reasonable values."""
        assert FUTURE_PRICE_RETRY_DELAY > 0
        assert FUTURE_PRICE_RETRY_DELAY <= 60  # Not more than 1 minute
        assert FUTURE_PRICE_MAX_RETRIES > 0
        assert FUTURE_PRICE_MAX_RETRIES <= 10  # Not too many retries
