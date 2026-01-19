"""
Event processor for handling PaymasterVault events.

This module contains the logic for processing PaymentInitiated events (source)
and HashStored events (target), coordinating proof generation + relay to
CrossChainPaymaster only after the corresponding block hash is published.
"""

import contextlib
import logging
from collections import OrderedDict, deque
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Optional

from web3.types import EventData

from .models import PaymentEvent
from .proof_manager import ProofManager

if TYPE_CHECKING:
    from .config import RelayerConfig

logger = logging.getLogger(__name__)


class EventProcessor:
    """Processes blockchain events for the Paymaster relayer."""

    MAX_PROCESSED_HASHES: int = 10_000
    MAX_PENDING_PAYMENTS: int = 10_000
    MAX_STORED_HASHES: int = 10_000

    def __init__(
        self,
        proof_manager: ProofManager | None = None,
        config: Optional["RelayerConfig"] = None,
    ) -> None:
        """Initialize the event processor.

        Args:
            proof_manager: ProofManager instance for generating and submitting proofs
            config: RelayerConfig instance for accessing target addresses
        """
        self.processed_tx_hashes: OrderedDict[str, None] = OrderedDict()

        self.pending_payments: dict[int, list[PaymentEvent]] = {}
        self.pending_payments_order: deque[PaymentEvent] = deque()

        self.stored_hashes: OrderedDict[int, str] = OrderedDict()

        self.proof_manager = proof_manager
        self.config = config

    async def process_payment_initiated(self, event: EventData) -> PaymentEvent | None:
        """
        Process a PaymentInitiated event from the source chain.

        Args:
            event: The PaymentInitiated event data

        Returns:
            PaymentEvent if successfully processed, None if skipped or error
        """
        try:
            match event.get("transactionHash"):
                case None:
                    logger.warning("Event missing transaction hash")
                    return None
                case bytes() as tx_hash_bytes:
                    tx_hash = tx_hash_bytes.hex()
                case str() as tx_hash:
                    pass  # Already a string
                case _:
                    logger.warning(
                        f"Unexpected transaction hash type: {type(event.get('transactionHash'))}"
                    )
                    return None

            # Skip if already processed
            if tx_hash in self.processed_tx_hashes:
                return None

            # Track processed transaction
            self._track_processed_hash(tx_hash)

            # Extract event data with type safety
            block_number: int = event.get("blockNumber", 0)
            args: Mapping[str, Any] = event.get("args", {})
            payer: str = args.get("payer", "0x0")
            recipient: str = args.get("recipient", "0x0")
            token: str = args.get("token", "0x0")
            amount: int = args.get("amount", 0)

            payment_event = PaymentEvent(
                tx_hash=tx_hash,
                block_number=block_number,
                payer=payer,
                recipient=recipient,
                token=token,
                amount=amount,
            )

            logger.info(
                f"PaymentInitiated detected - TX: {tx_hash[:10]}... block={block_number} "
                f"payer={payer} recipient={recipient} token={token} amount={amount}"
            )

            # Enqueue payment until its block hash is stored on Sapphire
            if len(self.pending_payments_order) >= self.MAX_PENDING_PAYMENTS:
                oldest = self.pending_payments_order.popleft()
                if oldest.block_number in self.pending_payments:
                    lst = self.pending_payments[oldest.block_number]
                    if oldest in lst:
                        lst.remove(oldest)
                        if not lst:
                            del self.pending_payments[oldest.block_number]
                logger.debug("Removed oldest pending payment due to capacity")

            if block_number not in self.pending_payments:
                self.pending_payments[block_number] = []
            self.pending_payments[block_number].append(payment_event)
            self.pending_payments_order.append(payment_event)

            return payment_event

        except Exception as e:
            logger.error(f"Error processing PaymentInitiated event: {e}", exc_info=True)
            return None

    async def process_hash_stored(self, event: EventData) -> tuple[int, str] | None:
        """
        Process a HashStored event from the ROFLAdapter on Sapphire.

        Args:
            event: The HashStored event data

        Returns:
            Tuple of (block_id, block_hash) if successful, None if error
        """
        try:
            args: Mapping[str, Any] = event.get("args", {})
            block_id: int = args.get("id", 0)

            match args.get("hash", "0x0"):
                case bytes() as hash_bytes:
                    block_hash = hash_bytes.hex()
                case str() as hash_str:
                    block_hash = hash_str
                case _:
                    block_hash = "0x0"

            # Store the hash with automatic eviction to prevent memory leak
            if len(self.stored_hashes) >= self.MAX_STORED_HASHES:
                self.stored_hashes.popitem(last=False)
            self.stored_hashes[block_id] = block_hash

            logger.info(f"Hash stored - Block {block_id}: {block_hash[:10]}...")

            matching_payments: list[PaymentEvent] = self.pending_payments.get(
                block_id, []
            )

            if matching_payments and self.proof_manager and self.config:
                logger.info(
                    f"Found {len(matching_payments)} payments ready for block {block_id}"
                )
                for p in list(matching_payments):
                    await self.process_matched_payment(p)

            return (block_id, block_hash)

        except Exception as e:
            logger.error(f"Error processing HashStored event: {e}", exc_info=True)
            return None

    def _track_processed_hash(self, tx_hash: str) -> None:
        """
        Track a processed transaction hash with automatic LRU eviction.

        Uses OrderedDict for O(1) lookups and automatic LRU behavior.
        When we reach capacity, we remove the oldest entry (first inserted).

        Args:
            tx_hash: Transaction hash to track
        """
        if tx_hash in self.processed_tx_hashes:
            self.processed_tx_hashes.move_to_end(tx_hash)
        else:
            if len(self.processed_tx_hashes) >= self.MAX_PROCESSED_HASHES:
                self.processed_tx_hashes.popitem(last=False)

            self.processed_tx_hashes[tx_hash] = None

    def _remove_from_pending(self, payment_event: PaymentEvent) -> bool:
        """Remove a payment from pending structures. Returns True if found and removed."""
        block_payments = self.pending_payments.get(payment_event.block_number, [])
        if payment_event not in block_payments:
            return False
        block_payments.remove(payment_event)
        if not block_payments:
            del self.pending_payments[payment_event.block_number]
        with contextlib.suppress(ValueError):
            self.pending_payments_order.remove(payment_event)
        return True

    def _add_to_pending(self, payment_event: PaymentEvent) -> None:
        """Add a payment back to pending structures."""
        if payment_event.block_number not in self.pending_payments:
            self.pending_payments[payment_event.block_number] = []
        if payment_event not in self.pending_payments[payment_event.block_number]:
            self.pending_payments[payment_event.block_number].append(payment_event)
        if payment_event not in self.pending_payments_order:
            self.pending_payments_order.append(payment_event)

    async def process_matched_payment(self, payment_event: PaymentEvent) -> bool:
        """
        Generate and submit a proof for a PaymentInitiated event.

        Uses optimistic removal: removes from pending BEFORE async submission
        to prevent duplicate processing by concurrent tasks (HashStored handler
        and retry task). Re-adds on failure.

        Args:
            payment_event: The payment event to process

        Returns:
            True if processing was attempted, False if skipped (already in progress)
        """
        if not self.proof_manager or not self.config:
            logger.warning(
                "ProofManager or config not initialized, skipping proof generation"
            )
            return False

        # Optimistic removal BEFORE any await - atomic in asyncio
        # This prevents race between HashStored handler and retry task
        if not self._remove_from_pending(payment_event):
            # Already removed by another task - skip to avoid duplicate submission
            logger.debug(f"Payment {payment_event.tx_hash[:10]}... already being processed")
            return False

        paymaster_address = self.config.target_chain.paymaster_address
        logger.info(
            f"Processing proof for PaymentInitiated to CrossChainPaymaster {paymaster_address}"
        )

        try:
            # Generate and submit proof
            tx_hash = await self.proof_manager.process_payment_event(
                payment_event, paymaster_address
            )

            if tx_hash is None:
                logger.warning(
                    f"Proof submission failed for tx {payment_event.tx_hash}, "
                    "will retry on next cycle"
                )
                self._add_to_pending(payment_event)
                return True

            logger.info(f"Proof submitted successfully: {tx_hash}")
            return True

        except Exception as e:
            logger.error(
                f"Failed to process proof for PaymentInitiated: {e}",
                exc_info=True,
            )
            # Re-add to pending for retry
            self._add_to_pending(payment_event)
            return True

    def get_stats(self) -> dict:
        """
        Get current processor statistics.

        Returns:
            Dictionary with current state metrics
        """
        return {
            "processed_hashes": len(self.processed_tx_hashes),
            "pending_payments": len(self.pending_payments_order),
            "stored_hashes": len(self.stored_hashes),
        }

    async def retry_pending_payments(self) -> int:
        """
        Retry pending payments that have hashes already stored.

        This handles the case where proof submission failed but the hash
        was already stored, so the HashStored event won't fire again.

        Returns:
            Number of payments retried
        """
        if not self.proof_manager or not self.config:
            return 0

        retried = 0
        for block_number, payments in list(self.pending_payments.items()):
            if block_number in self.stored_hashes:
                for payment in list(payments):
                    logger.info(
                        f"Retrying pending payment for block {block_number}, "
                        f"tx {payment.tx_hash}"
                    )
                    if await self.process_matched_payment(payment):
                        retried += 1

        return retried
