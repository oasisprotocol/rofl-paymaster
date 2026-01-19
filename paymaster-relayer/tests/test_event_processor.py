"""Unit tests for the EventProcessor class (Paymaster relayer)."""

import os
import sys
from collections import OrderedDict

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from paymaster_relayer.event_processor import EventProcessor
from paymaster_relayer.models import PaymentEvent


class TestEventProcessor:
    """Test suite for EventProcessor class."""

    def test_processed_hash_tracking_with_lru(self):
        """Test that hash tracking maintains LRU behavior with O(1) lookups."""
        processor = EventProcessor()

        # Set a smaller max for testing
        processor.MAX_PROCESSED_HASHES = 5
        processor.processed_tx_hashes = OrderedDict()

        # Add hashes up to capacity
        hashes = [f"0xhash{i}" for i in range(5)]
        for hash_val in hashes:
            processor._track_processed_hash(hash_val)

        # Verify all hashes are tracked
        assert len(processor.processed_tx_hashes) == 5
        for hash_val in hashes:
            assert hash_val in processor.processed_tx_hashes

        # Add one more hash - should evict the oldest (hash0)
        processor._track_processed_hash("0xhash5")

        # Verify LRU eviction worked correctly
        assert len(processor.processed_tx_hashes) == 5
        assert "0xhash0" not in processor.processed_tx_hashes
        assert "0xhash5" in processor.processed_tx_hashes

        # Verify OrderedDict order (oldest to newest)
        expected_order = ["0xhash1", "0xhash2", "0xhash3", "0xhash4", "0xhash5"]
        assert list(processor.processed_tx_hashes.keys()) == expected_order

    def test_duplicate_hash_moves_to_end(self):
        """Test that duplicate hashes are moved to end (most recent) in LRU."""
        processor = EventProcessor()

        # Track multiple hashes
        processor._track_processed_hash("0xabc123")
        processor._track_processed_hash("0xdef456")
        processor._track_processed_hash("0xghi789")

        # Re-track the first hash (should move to end)
        processor._track_processed_hash("0xabc123")

        # Verify hash was moved to end and no duplicate was added
        assert len(processor.processed_tx_hashes) == 3
        assert list(processor.processed_tx_hashes.keys()) == [
            "0xdef456",
            "0xghi789",
            "0xabc123",
        ]

    def test_get_stats(self):
        """Test that get_stats returns expected keys and values."""
        processor = EventProcessor()
        processor.processed_tx_hashes["0x1"] = None
        processor.processed_tx_hashes["0x2"] = None

        stats = processor.get_stats()
        assert stats["processed_hashes"] == 2
        assert "pending_payments" in stats
        assert "stored_hashes" in stats

    def test_remove_from_pending_returns_true_when_found(self):
        """Test _remove_from_pending returns True when payment exists."""
        processor = EventProcessor()
        payment = PaymentEvent(
            tx_hash="0xabc123",
            block_number=100,
            payer="0x1",
            recipient="0x2",
            token="0x3",
            amount=1000,
        )
        processor.pending_payments[100] = [payment]
        processor.pending_payments_order.append(payment)

        result = processor._remove_from_pending(payment)

        assert result is True
        assert 100 not in processor.pending_payments
        assert payment not in processor.pending_payments_order

    def test_remove_from_pending_returns_false_when_not_found(self):
        """Test _remove_from_pending returns False when payment doesn't exist."""
        processor = EventProcessor()
        payment = PaymentEvent(
            tx_hash="0xabc123",
            block_number=100,
            payer="0x1",
            recipient="0x2",
            token="0x3",
            amount=1000,
        )

        result = processor._remove_from_pending(payment)

        assert result is False

    def test_add_to_pending_is_idempotent(self):
        """Test _add_to_pending doesn't create duplicates."""
        processor = EventProcessor()
        payment = PaymentEvent(
            tx_hash="0xabc123",
            block_number=100,
            payer="0x1",
            recipient="0x2",
            token="0x3",
            amount=1000,
        )

        # Add twice
        processor._add_to_pending(payment)
        processor._add_to_pending(payment)

        assert len(processor.pending_payments[100]) == 1
        assert len(processor.pending_payments_order) == 1

    async def test_process_matched_payment_skips_if_already_removed(self):
        """Test that concurrent calls skip if payment already removed (race prevention)."""
        processor = EventProcessor()
        payment = PaymentEvent(
            tx_hash="0xabc123",
            block_number=100,
            payer="0x1",
            recipient="0x2",
            token="0x3",
            amount=1000,
        )
        # Payment NOT in pending (simulates already removed by another task)

        # Should return False (skipped, not attempted)
        result = await processor.process_matched_payment(payment)

        assert result is False
        # Should not be added back (no crash, no side effects)
        assert 100 not in processor.pending_payments
