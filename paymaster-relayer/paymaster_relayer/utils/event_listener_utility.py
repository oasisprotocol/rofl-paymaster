"""
Event Listener Utility for real-time blockchain event monitoring.

Provides WebSocket-based event listening with automatic reconnection capabilities.
"""

import asyncio
import logging
from collections.abc import Callable
from enum import Enum
from typing import Any

from web3 import AsyncWeb3, Web3
from web3.providers import WebSocketProvider
from web3.types import EventData
from web3.utils.subscriptions import LogsSubscription, LogsSubscriptionContext


class ConnectionState(Enum):
    """Connection state for event listener."""

    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    RECONNECTING = "reconnecting"
    FAILED = "failed"


class EventListenerUtility:
    """
    Utility for listening to blockchain events via WebSocket.

    Features:
    - Real-time WebSocket event listening with <1 second latency
    - Connection health monitoring and automatic reconnection
    - Configurable retry logic and error handling
    """

    def __init__(
        self,
        rpc_url: str,
        websocket_url: str | None = None,
        max_retries: int = 5,
        heartbeat_interval: int = 30,
    ) -> None:
        """
        Initialize the EventListenerUtility.

        Args:
            rpc_url: HTTP RPC endpoint URL (used for WebSocket URL generation if websocket_url not provided)
            websocket_url: WebSocket RPC endpoint URL (auto-generated if not provided)
            max_retries: Maximum retry attempts for connection
            heartbeat_interval: Health check interval in seconds
        """
        self.rpc_url = rpc_url
        self.websocket_url = websocket_url or self._convert_to_websocket_url(rpc_url)
        self.max_retries = max_retries
        self.heartbeat_interval = heartbeat_interval

        # Connection state
        self.connection_state = ConnectionState.DISCONNECTED

        # Web3 instances
        self.async_w3: AsyncWeb3 | None = None
        self.subscription_id: str | None = None

        # Event processing
        self.event_callback: Callable | None = None

        # Retry configuration
        self.base_delay = 1
        self.max_delay = 60

        # Setup logging
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")

    def _convert_to_websocket_url(self, http_url: str) -> str:
        """Convert HTTP RPC URL to WebSocket URL."""
        if http_url.startswith("https://"):
            ws_url = http_url.replace("https://", "wss://")
        elif http_url.startswith("http://"):
            ws_url = http_url.replace("http://", "ws://")
        else:
            return http_url

        return ws_url

    async def listen_for_contract_events(
        self,
        contract_address: str,
        event_obj: Any,  # Contract event object from web3.contract.events.EventName()
        callback: Callable[[EventData], Any],
    ) -> None:
        """
        Main entry point for WebSocket event listening using contract event objects.

        Args:
            contract_address: Address of the contract to listen to
            event_obj: Contract event object (e.g., contract.events.Transfer())
            callback: Async function to call when events are received
        """
        self.event_callback = callback
        self.logger.info(
            f"Starting WebSocket event listener for {event_obj.event_name}"
        )

        await self._websocket_listener(contract_address, event_obj)

    async def _websocket_listener(self, contract_address: str, event_obj: Any) -> None:
        """WebSocket-based event listening using contract event objects."""
        retry_count = 0

        while retry_count < self.max_retries:
            try:
                self.connection_state = ConnectionState.CONNECTING
                self.logger.info(f"Connecting to WebSocket: {self.websocket_url}")

                # Create WebSocket connection using modern subscription manager
                async with AsyncWeb3(
                    WebSocketProvider(
                        self.websocket_url,
                        request_timeout=60,
                        subscription_response_queue_size=10000,
                    )
                ) as w3:
                    self.async_w3 = w3
                    self.connection_state = ConnectionState.CONNECTED
                    self.logger.info("WebSocket connected successfully")

                    # Use the simple approach: event_obj.topic for topic generation
                    topics = [event_obj.topic]

                    # Create LogsSubscription with proper parameters for eth_subscribe
                    logs_subscription = LogsSubscription(
                        label=f"{event_obj.event_name}-subscription",
                        address=Web3.to_checksum_address(contract_address),
                        topics=topics,
                        handler=self._log_handler,
                    )

                    self.logger.info(
                        f"Subscribing to {event_obj.event_name} events on {contract_address}"
                    )
                    self.logger.info(f"Event topic: {topics[0]}")

                    # Subscribe using the subscription manager
                    await w3.subscription_manager.subscribe([logs_subscription])

                    # Handle subscriptions indefinitely
                    await w3.subscription_manager.handle_subscriptions()

                # If we reach here, connection was successful
                retry_count = 0

            except (ConnectionError, OSError) as e:
                retry_count += 1
                delay = min(self.base_delay * (2**retry_count), self.max_delay)

                self.logger.warning(
                    f"WebSocket connection failed (attempt {retry_count}/{self.max_retries}): {e}"
                )

                if retry_count < self.max_retries:
                    self.logger.info(f"Retrying in {delay} seconds...")
                    self.connection_state = ConnectionState.RECONNECTING
                    await asyncio.sleep(delay)
                else:
                    self.logger.error("Max WebSocket retries reached")
                    self.connection_state = ConnectionState.FAILED
                    raise

    async def _log_handler(self, handler_context: LogsSubscriptionContext) -> None:
        """
        Handler for LogsSubscription events using the modern subscription manager.

        Args:
            handler_context: Context containing the log receipt and subscription details
        """
        try:
            log_receipt = handler_context.result

            if hasattr(log_receipt, "get") and callable(log_receipt.get):
                event_data = {
                    "address": log_receipt.get("address"),
                    "blockHash": log_receipt.get("blockHash"),
                    "blockNumber": int(str(log_receipt.get("blockNumber", "0x0")), 16),
                    "data": log_receipt.get("data"),
                    "logIndex": int(str(log_receipt.get("logIndex", "0x0")), 16),
                    "topics": log_receipt.get("topics", []),
                    "transactionHash": log_receipt.get("transactionHash"),
                    "transactionIndex": int(
                        str(log_receipt.get("transactionIndex", "0x0")), 16
                    ),
                }
            else:
                event_data = {
                    "address": getattr(log_receipt, "address", None),
                    "blockHash": getattr(log_receipt, "blockHash", None),
                    "blockNumber": int(
                        str(getattr(log_receipt, "blockNumber", "0x0")), 16
                    ),
                    "data": getattr(log_receipt, "data", None),
                    "logIndex": int(str(getattr(log_receipt, "logIndex", "0x0")), 16),
                    "topics": getattr(log_receipt, "topics", []),
                    "transactionHash": getattr(log_receipt, "transactionHash", None),
                    "transactionIndex": int(
                        str(getattr(log_receipt, "transactionIndex", "0x0")), 16
                    ),
                }

            if self.event_callback:
                await self.event_callback(event_data)

        except Exception as e:
            self.logger.error(
                f"Error processing subscription event: {e}", exc_info=True
            )

    async def stop(self) -> None:
        """Stop the event listener and clean up resources."""
        self.logger.info("Stopping event listener...")

        try:
            if self.async_w3 and self.subscription_id:
                await self.async_w3.eth.unsubscribe(self.subscription_id)  # type: ignore

            if (
                self.async_w3
                and hasattr(self.async_w3, "provider")
                and hasattr(self.async_w3.provider, "disconnect")
            ):
                await self.async_w3.provider.disconnect()

        except Exception as e:
            self.logger.warning(f"Error during cleanup: {e}")
        finally:
            self.connection_state = ConnectionState.DISCONNECTED
            self.async_w3 = None
            self.subscription_id = None


def parse_event_topic_as_int(topic: Any) -> int:
    """
    Parse an event topic (bytes or hex string) as an integer.

    Ethereum event topics can come in different formats depending on the provider:
    - As bytes objects: b'\x00\x00...\xaa6\xa7'
    - As hex strings: "0x000000000000000000000000000000000000aa36a7"

    :param topic: The topic to parse (bytes, str, or other)
    :return: Integer value of the topic
    """
    if isinstance(topic, bytes):
        return int.from_bytes(topic, byteorder="big")
    elif isinstance(topic, str):
        # Remove '0x' prefix if present
        hex_str = topic[2:] if topic.startswith("0x") else topic
        return int(hex_str, 16) if hex_str else 0
    else:
        return 0
