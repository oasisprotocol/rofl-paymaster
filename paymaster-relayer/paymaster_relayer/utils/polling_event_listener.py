"""
Polling-based event listener utility for blockchain event monitoring.

"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from web3 import Web3
from web3.types import EventData

if TYPE_CHECKING:
    from .multi_rpc_provider import MultiRpcProvider


class PollingEventListener:
    """
    Utility for polling blockchain events via HTTP RPC.

    Uses MultiRpcProvider for automatic failover support.
    """

    def __init__(
        self,
        provider: MultiRpcProvider,
        contract_address: str,
        event_name: str,
        abi: list[dict[str, Any]],
        lookback_blocks: int = 100,
        max_block_range: int | None = None,
    ):
        """
        Initialize the polling event listener.

        Args:
            provider: MultiRpcProvider instance for RPC failover
            contract_address: Address of the contract to monitor
            event_name: Name of the event to listen for
            abi: Contract ABI
            lookback_blocks: Number of blocks to look back on startup
            max_block_range: Max blocks per get_logs request (None = no limit)
        """
        self.contract_address = Web3.to_checksum_address(contract_address)
        self.event_name = event_name
        self.lookback_blocks = lookback_blocks
        self.max_block_range = max_block_range
        self.abi = abi
        self.provider = provider

        # Validate event exists in ABI
        temp_contract = self.provider.get_web3().eth.contract(
            address=self.contract_address, abi=abi
        )
        if not hasattr(temp_contract.events, event_name):
            raise ValueError(f"Event {event_name} not found in contract ABI")

        # State tracking
        self.last_processed_block: int | None = None
        self.is_running = False

        # Setup logging
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")

    def _get_logs_chunked_with_w3(
        self, w3: Web3, from_block: int, to_block: int
    ) -> list[EventData]:
        """Fetch logs in chunks using a specific Web3 instance for consistency."""
        if self.max_block_range is None or to_block - from_block < self.max_block_range:
            return self._get_logs_range_with_w3(w3, from_block, to_block)

        all_events: list[EventData] = []
        current_from = from_block

        while current_from <= to_block:
            current_to = min(current_from + self.max_block_range - 1, to_block)
            self.logger.debug(
                f"Fetching logs chunk: blocks {current_from}-{current_to}"
            )
            events = self._get_logs_range_with_w3(w3, current_from, current_to)
            all_events.extend(events)
            current_from = current_to + 1

        return all_events

    def _get_logs_range_with_w3(
        self, w3: Web3, from_block: int, to_block: int
    ) -> list[EventData]:
        """Get logs for a single block range using a specific Web3 instance."""
        contract = w3.eth.contract(address=self.contract_address, abi=self.abi)
        event_obj = getattr(contract.events, self.event_name)
        return list(event_obj.get_logs(from_block=from_block, to_block=to_block))

    def _sync_cycle(self, w3: Web3, lookback: int) -> tuple[int, list[EventData]]:
        """Execute a complete initial sync cycle using a single Web3 instance."""
        current_block = w3.eth.block_number
        from_block = max(0, current_block - lookback)
        events = self._get_logs_chunked_with_w3(w3, from_block, current_block)
        return current_block, events

    def _poll_cycle(self, w3: Web3) -> tuple[int, list[EventData]]:
        """Execute a complete poll cycle using a single Web3 instance.

        Ensures block number and logs come from the same provider,
        preventing inconsistency if failover occurs between calls.
        """
        current_block = w3.eth.block_number

        if self.last_processed_block and current_block <= self.last_processed_block:
            return current_block, []

        from_block = (
            (self.last_processed_block + 1)
            if self.last_processed_block
            else current_block
        )

        events = self._get_logs_chunked_with_w3(w3, from_block, current_block)
        return current_block, events

    async def initial_sync(self, callback: Callable[[EventData], Any]) -> None:
        """
        Perform initial sync to catch up on recent events.

        Args:
            callback: Async function to call for each event found
        """
        try:
            # Single failover context for consistency
            current_block, events = await asyncio.to_thread(
                self.provider.execute_with_failover,
                lambda w3: self._sync_cycle(w3, self.lookback_blocks),
            )

            self.logger.info(
                f"Initial sync for {self.event_name} events up to block {current_block}"
            )

            if events:
                self.logger.info(
                    f"Found {len(events)} historical {self.event_name} events"
                )
                for event in events:
                    await callback(event)
            else:
                self.logger.info(f"No historical {self.event_name} events found")

            # Set last processed block
            self.last_processed_block = current_block

        except Exception as e:
            self.logger.error(f"Error during initial sync: {e}")
            raise

    async def poll_for_events(self, callback: Callable[[EventData], Any]) -> None:
        """
        Poll for new events since last processed block.

        Args:
            callback: Async function to call for each new event
        """
        try:
            # Single failover context ensures block number and
            # logs come from the same provider (same sync state)
            current_block, events = await asyncio.to_thread(
                self.provider.execute_with_failover,
                self._poll_cycle,
            )

            # Skip if no new blocks
            if self.last_processed_block and current_block <= self.last_processed_block:
                return

            if events:
                self.logger.info(
                    f"Found {len(events)} new {self.event_name} events "
                    f"in blocks up to {current_block}"
                )
                for event in events:
                    await callback(event)

            # Update last processed block
            self.last_processed_block = current_block

        except Exception as e:
            self.logger.error(f"Error polling for events: {e}")
            # Don't update last_processed_block on error

    async def start_polling(
        self, callback: Callable[[EventData], Any], interval: int = 30
    ) -> None:
        """
        Start polling for events at the specified interval.

        Args:
            callback: Async function to call when events are received
            interval: Polling interval in seconds
        """
        if self.is_running:
            self.logger.warning("Polling already running")
            return

        self.is_running = True
        self.logger.info(
            f"Starting polling for {self.event_name} events "
            f"on {self.contract_address} every {interval} seconds"
        )

        # Perform initial sync
        await self.initial_sync(callback)

        # Main polling loop
        while self.is_running:
            try:
                await asyncio.sleep(interval)
                await self.poll_for_events(callback)
            except asyncio.CancelledError:
                self.logger.info("Polling cancelled")
                break
            except Exception as e:
                self.logger.error(f"Error in polling loop: {e}")
                # Continue polling despite errors
                await asyncio.sleep(interval)

    async def stop(self) -> None:
        """Stop the polling loop."""
        self.logger.info(f"Stopping polling for {self.event_name} events")
        self.is_running = False

    def get_status(self) -> dict[str, Any]:
        """
        Get current status of the polling listener.

        Returns:
            Dictionary with status information
        """
        return {
            "is_running": self.is_running,
            "last_processed_block": self.last_processed_block,
            "contract_address": self.contract_address,
            "event_name": self.event_name,
            "rpc_url": self.provider.current_url_sanitized,
        }
