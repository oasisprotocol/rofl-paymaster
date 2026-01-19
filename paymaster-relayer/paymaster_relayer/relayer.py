"""
Paymaster Relayer implementation.

This module contains the main relayer service that orchestrates event monitoring
and coordinates with the event processor for handling blockchain events.
"""

import asyncio
import contextlib
import logging

from web3 import Web3

from .config import RelayerConfig
from .event_processor import EventProcessor
from .proof_manager import ProofManager
from .utils.contract_utility import ContractUtility
from .utils.polling_event_listener import PollingEventListener
from .utils.rofl_utility import RoflUtility

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


class ROFLRelayer:
    """
    Main relayer service that orchestrates event monitoring and processing.

    This class focuses on coordination and lifecycle management, delegating
    event processing logic to the EventProcessor.
    """

    STATUS_LOG_INTERVAL = 30  # seconds
    RETRY_PENDING_INTERVAL = 30  # seconds between retry attempts

    def __init__(self, config: RelayerConfig):
        """
        Initialize the ROFL Relayer.

        Args:
            config: Relayer configuration
        """
        self.config = config
        self.running = False

        self._init_utilities()

        self.event_processor = EventProcessor(
            proof_manager=self.proof_manager, config=config
        )
        self.payment_listener: PollingEventListener | None = None
        self.hash_listener: PollingEventListener | None = None

        self.shutdown_event = asyncio.Event()

    def _init_utilities(self) -> None:
        """
        Initialize utility classes for proof generation.
        """
        # Initialize Web3 for source chain
        self.w3_source = Web3(Web3.HTTPProvider(self.config.source_chain.rpc_url))
        if not self.w3_source.is_connected():
            raise Exception(
                f"Failed to connect to source chain at {self.config.source_chain.rpc_url}"
            )

        # Initialize contract utility for target chain
        self.contract_util = ContractUtility(
            rpc_url=self.config.target_chain.rpc_url,
            secret=self.config.target_chain.private_key or "",
        )

        self.rofl_util = None if self.config.local_mode else RoflUtility()

        self.proof_manager = ProofManager(
            w3_source=self.w3_source,
            contract_util=self.contract_util,
            rofl_util=self.rofl_util,
        )

        source_chain_id = self.w3_source.eth.chain_id
        logger.info(
            f"Paymaster Relayer initialized ({'LOCAL' if self.config.local_mode else 'ROFL'} mode, source chain: {source_chain_id})"
        )

    @classmethod
    def from_env(cls, local_mode: bool = False) -> "ROFLRelayer":
        """
        Create a ROFLRelayer instance from environment variables.

        Args:
            local_mode: Run in local mode without ROFL utilities

        Returns:
            Configured ROFLRelayer instance

        Raises:
            ValueError: If required environment variables are missing
        """
        config = RelayerConfig.from_env(local_mode=local_mode)
        config.log_config()
        return cls(config)

    async def init_event_monitoring(self) -> None:
        """Initialize polling listener for PaymentInitiated events."""
        logger.info("Initializing event monitoring...")

        # Load ABIs
        paymaster_vault_abi = self.contract_util.get_contract_abi("PaymasterVault")
        rofl_adapter_abi = self.contract_util.get_contract_abi("ROFLAdapter")

        # Initialize PaymentInitiated event listener (source chain)
        self.payment_listener = PollingEventListener(
            rpc_url=self.config.source_chain.rpc_url,
            contract_address=self.config.source_chain.paymaster_vault_address,
            event_name="PaymentInitiated",
            abi=paymaster_vault_abi,
            lookback_blocks=self.config.monitoring.lookback_blocks,
            max_block_range=self.config.monitoring.max_block_range,
        )

        logger.info(
            f"PaymasterVault listener: {self.config.source_chain.paymaster_vault_address}"
        )

        # Initialize ROFLAdapter event listener (target chain - Sapphire)
        self.hash_listener = PollingEventListener(
            rpc_url=self.config.target_chain.rpc_url,
            contract_address=self.config.target_chain.rofl_adapter_address,
            event_name="HashStored",
            abi=rofl_adapter_abi,
            lookback_blocks=self.config.monitoring.lookback_blocks,
            max_block_range=self.config.monitoring.max_block_range,
        )
        logger.info(
            f"ROFLAdapter listener: {self.config.target_chain.rofl_adapter_address}"
        )

    async def _periodic_status_logger(self) -> None:
        """Log status periodically while running."""
        while self.running:
            await asyncio.sleep(self.STATUS_LOG_INTERVAL)
            stats = self.event_processor.get_stats()
            if stats["pending_payments"] > 0:
                logger.info(
                    f"Status: {stats['pending_payments']} payments pending, "
                    f"{stats['processed_hashes']} processed, "
                    f"{stats['stored_hashes']} hashes stored"
                )

    async def _periodic_retry_pending(self) -> None:
        """Periodically retry pending payments that have hashes stored."""
        while self.running:
            await asyncio.sleep(self.RETRY_PENDING_INTERVAL)
            try:
                retried = await self.event_processor.retry_pending_payments()
                if retried > 0:
                    logger.info(f"Retried {retried} pending payment(s)")
            except Exception as e:
                logger.error(f"Error retrying pending payments: {e}", exc_info=True)

    async def _check_task_health(self, tasks: dict[str, asyncio.Task]) -> bool:
        """Check if any critical task has failed."""
        for name, task in tasks.items():
            if task.done() and name != "status":
                try:
                    await task
                except Exception as e:
                    logger.error(f"{name} task failed: {e}", exc_info=True)
                return False
        return True

    async def _cleanup_tasks(self, tasks: dict[str, asyncio.Task]) -> None:
        """Clean up all tasks and listeners."""
        if self.payment_listener:
            await self.payment_listener.stop()
        if self.hash_listener:
            await self.hash_listener.stop()

        for _name, task in tasks.items():
            if not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

    async def run(self) -> None:
        """Main event loop for the relayer service."""
        self.running = True
        logger.info("Paymaster Relayer starting...")
        logger.info(f"Polling interval: {self.config.monitoring.polling_interval}s")
        logger.info(f"Lookback blocks: {self.config.monitoring.lookback_blocks}")

        tasks = {}
        try:
            await self.init_event_monitoring()

            if not self.payment_listener or not self.hash_listener:
                raise RuntimeError("Event listeners not properly initialized")

            tasks = {
                "payment": asyncio.create_task(
                    self.payment_listener.start_polling(
                        callback=self.event_processor.process_payment_initiated,
                        interval=self.config.monitoring.polling_interval,
                    )
                ),
                "hash": asyncio.create_task(
                    self.hash_listener.start_polling(
                        callback=self.event_processor.process_hash_stored,
                        interval=self.config.monitoring.polling_interval,
                    )
                ),
                "status": asyncio.create_task(self._periodic_status_logger()),
                "retry": asyncio.create_task(self._periodic_retry_pending()),
            }

            logger.info("Event monitoring started, waiting for events...")

            while self.running:
                try:
                    await asyncio.wait_for(self.shutdown_event.wait(), timeout=1.0)
                    break  # Shutdown requested
                except TimeoutError:
                    pass  # Continue running

                if not await self._check_task_health(tasks):
                    logger.error("Critical task failure, shutting down")
                    break

        except Exception as e:
            logger.error(f"Error in main loop: {e}", exc_info=True)
            raise
        finally:
            await self._cleanup_tasks(tasks)
            logger.info("Paymaster Relayer stopped")

    def stop(self) -> None:
        """Stop the relayer service."""
        self.running = False
        self.shutdown_event.set()
