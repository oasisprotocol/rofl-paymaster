"""
Polling-based event listener utility for blockchain event monitoring.

"""

import asyncio
import logging
from collections.abc import Callable
from typing import Any

from web3 import Web3
from web3.types import EventData


class PollingEventListener:
    """
    Utility for polling blockchain events via HTTP RPC.

    """

    def __init__(
        self,
        rpc_url: str,
        contract_address: str,
        event_name: str,
        abi: list[dict[str, Any]],
        lookback_blocks: int = 100,
    ):
        """
        Initialize the polling event listener.

        Args:
            rpc_url: HTTP RPC endpoint URL
            contract_address: Address of the contract to monitor
            event_name: Name of the event to listen for
            abi: Contract ABI
            lookback_blocks: Number of blocks to look back on startup
        """
        self.rpc_url = rpc_url
        self.contract_address = Web3.to_checksum_address(contract_address)
        self.event_name = event_name
        self.lookback_blocks = lookback_blocks

        # Initialize Web3 connection
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))

        # Create contract instance
        self.contract = self.w3.eth.contract(address=self.contract_address, abi=abi)

        # Get the event object
        if not hasattr(self.contract.events, event_name):
            raise ValueError(f"Event {event_name} not found in contract ABI")
        self.event_obj = getattr(self.contract.events, event_name)

        # State tracking
        self.last_processed_block: int | None = None
        self.is_running = False

        # Setup logging
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")

    async def initial_sync(self, callback: Callable[[EventData], Any]) -> None:
        """
        Perform initial sync to catch up on recent events.

        Args:
            callback: Async function to call for each event found
        """
        try:
            current_block = self.w3.eth.block_number
            from_block = max(0, current_block - self.lookback_blocks)

            self.logger.info(
                f"Initial sync for {self.event_name} events "
                f"from block {from_block} to {current_block}"
            )

            # Get historical events using web3 v7 API
            events = self.event_obj.get_logs(
                from_block=from_block, to_block=current_block
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
            current_block = self.w3.eth.block_number

            # Skip if no new blocks
            if self.last_processed_block and current_block <= self.last_processed_block:
                return

            from_block = (
                (self.last_processed_block + 1)
                if self.last_processed_block
                else current_block
            )

            # Get new events
            events = self.event_obj.get_logs(
                from_block=from_block, to_block=current_block
            )

            if events:
                self.logger.info(
                    f"Found {len(events)} new {self.event_name} events "
                    f"in blocks {from_block}-{current_block}"
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
            "rpc_url": self.rpc_url,
        }
