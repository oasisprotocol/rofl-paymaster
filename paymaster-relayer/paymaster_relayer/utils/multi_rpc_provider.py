"""
Multi-RPC Web3 Provider with sequential failover.

Wraps Web3 with automatic failover across multiple RPC endpoints.
"""

import logging
import threading
from collections.abc import Callable
from typing import TypeVar
from urllib.parse import urlparse

from requests.exceptions import ConnectionError as RequestsConnectionError
from requests.exceptions import Timeout as RequestsTimeout
from web3 import Web3
from web3.exceptions import ProviderConnectionError, Web3RPCError

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Errors that indicate network/transport issues and should trigger failover.
# Application errors (ValueError, KeyError, etc.) are NOT included - they should propagate.
RETRYABLE_ERRORS = (
    Web3RPCError,
    ProviderConnectionError,
    RequestsConnectionError,
    RequestsTimeout,
    OSError,
    TimeoutError,
    ConnectionResetError,
)


def sanitize_url(url: str) -> str:
    """Redact sensitive parts of URL for safe logging.

    Strips path, query params, and fragments to avoid leaking API keys.
    Returns only scheme://host:port format.
    """
    try:
        parsed = urlparse(url)
        # Include port if non-standard
        netloc = parsed.hostname or "unknown"
        if parsed.port:
            netloc = f"{netloc}:{parsed.port}"
        return f"{parsed.scheme}://{netloc}/***"
    except Exception:
        return "***redacted***"


class MultiRpcProvider:
    """
    Web3 provider wrapper with sequential failover across multiple RPC endpoints.

    Automatically switches to the next provider when the current one fails.
    Implements exponential backoff when all providers fail and cycles back.
    """

    def __init__(
        self,
        rpc_urls: list[str],
        max_backoff: int = 30,
    ) -> None:
        """
        Initialize with a list of RPC URLs.

        Args:
            rpc_urls: List of RPC endpoint URLs in priority order
            max_backoff: Maximum backoff time in seconds (default 30)

        Raises:
            ValueError: If rpc_urls is empty
            Exception: If shutdown is requested during initialization
        """
        if not rpc_urls:
            raise ValueError("At least one RPC URL is required")

        self._rpc_urls = rpc_urls
        self._max_backoff = max_backoff
        self._current_index = 0
        self._web3: Web3 | None = None
        self._cycle_count = 0
        self._expected_chain_id: int | None = None
        self._shutdown_event = threading.Event()

        # Try to connect on initialization
        self._connect_with_failover()

        # Cache chain ID from first successful connection for failover validation
        try:
            self._expected_chain_id = self._web3.eth.chain_id
            logger.info(f"Connected to chain ID: {self._expected_chain_id}")
        except Exception as e:
            logger.warning(f"Could not determine chain ID on init: {e}")

    def _connect_with_failover(self) -> None:
        """Attempt to connect, cycling through providers with backoff indefinitely."""
        attempts = 0
        total_providers = len(self._rpc_urls)
        log_thresholds = [10, 50, 100]  # Escalating warnings

        while not self._shutdown_event.is_set():
            url = self._rpc_urls[self._current_index]
            logger.info(f"Connecting to RPC: {sanitize_url(url)}")

            try:
                self._web3 = Web3(Web3.HTTPProvider(url))
                if self._web3.is_connected():
                    logger.info(f"Connected to RPC: {sanitize_url(url)}")
                    self._cycle_count = 0  # Reset on successful connection
                    return
                else:
                    logger.warning(f"Failed to connect to {sanitize_url(url)}")
            except Exception as e:
                logger.warning(f"Connection error for {sanitize_url(url)}: {e}")

            # Move to next provider
            attempts += 1
            self._current_index = (self._current_index + 1) % total_providers

            # Check if we've completed a cycle
            if self._current_index == 0 and attempts > 0:
                self._cycle_count += 1
                backoff = min(2**self._cycle_count, self._max_backoff)

                # Progressive warning logs at thresholds
                if self._cycle_count in log_thresholds:
                    logger.error(
                        f"All providers have failed for {self._cycle_count} cycles "
                        f"(~{self._cycle_count * backoff}s total). Still retrying..."
                    )
                elif (
                    self._cycle_count > max(log_thresholds)
                    and self._cycle_count % 100 == 0
                ):
                    logger.error(f"Still failing after {self._cycle_count} cycles...")
                else:
                    logger.warning(
                        f"All providers failed. Cycle {self._cycle_count}. "
                        f"Backing off for {backoff}s..."
                    )

                # Interruptible sleep using Event.wait()
                if self._shutdown_event.wait(timeout=backoff):
                    raise Exception("Shutdown requested during initialization")

        raise Exception("Shutdown requested during initialization")

    def _validate_chain_id(self, url: str) -> None:
        """Validate that the current provider's chain ID matches the expected one.

        Called after each successful failover to catch misconfigured providers.

        Args:
            url: The URL of the provider being validated (for error messages)

        Raises:
            ValueError: If chain ID doesn't match the expected chain ID
        """
        if self._expected_chain_id is None or self._web3 is None:
            return

        try:
            actual_chain_id = self._web3.eth.chain_id
            if actual_chain_id != self._expected_chain_id:
                raise ValueError(
                    f"Chain ID mismatch on failover to {sanitize_url(url)}: "
                    f"expected {self._expected_chain_id}, got {actual_chain_id}. "
                    "All providers must point to the same chain."
                )
        except ValueError:
            raise  # Re-raise chain ID mismatches
        except Exception as e:
            logger.warning(f"Could not verify chain ID for {sanitize_url(url)}: {e}")

    @property
    def current_provider_index(self) -> int:
        """Return the index of the current active provider."""
        return self._current_index

    @property
    def current_url(self) -> str:
        """Return the URL of the current active provider."""
        return self._rpc_urls[self._current_index]

    @property
    def current_url_sanitized(self) -> str:
        """Return the sanitized URL of the current active provider (safe for logging)."""
        return sanitize_url(self._rpc_urls[self._current_index])

    @property
    def chain_id(self) -> int:
        """Return the chain ID from the current provider."""
        return self.get_web3().eth.chain_id

    def is_connected(self) -> bool:
        """Check if currently connected to an RPC provider."""
        return self._web3 is not None and self._web3.is_connected()

    def get_web3(self) -> Web3:
        """Return the current Web3 instance."""
        if self._web3 is None:
            raise Exception("Not connected to any RPC provider")
        return self._web3

    def shutdown(self) -> None:
        """Signal shutdown to interrupt retry loops gracefully."""
        self._shutdown_event.set()
        logger.info("Shutdown signal received, interrupting retry loops...")

    def _failover_to_next(self) -> None:
        """Switch to the next provider in the list, retrying indefinitely."""
        total_providers = len(self._rpc_urls)
        start_index = self._current_index
        log_thresholds = [10, 50, 100]

        while not self._shutdown_event.is_set():
            self._current_index = (self._current_index + 1) % total_providers

            # Track cycle completion before attempting provider
            completed_cycle = self._current_index == start_index
            if completed_cycle:
                self._cycle_count += 1

            url = self._rpc_urls[self._current_index]
            logger.info(f"Failing over to: {sanitize_url(url)}")

            try:
                self._web3 = Web3(Web3.HTTPProvider(url))
                if self._web3.is_connected():
                    self._validate_chain_id(url)
                    logger.info(f"Successfully failed over to: {sanitize_url(url)}")
                    self._cycle_count = 0  # Reset on successful connection
                    return
            except ValueError:
                raise  # Chain ID mismatch is fatal
            except Exception as e:
                logger.warning(
                    f"Failover connection error for {sanitize_url(url)}: {e}"
                )

            # Sleep AFTER confirming provider is still down on cycle completion
            if completed_cycle:
                backoff = min(2**self._cycle_count, self._max_backoff)

                # Progressive warning logs
                if self._cycle_count in log_thresholds:
                    logger.error(
                        f"All providers have failed for {self._cycle_count} cycles "
                        f"(~{self._cycle_count * backoff}s total). Still retrying..."
                    )
                elif (
                    self._cycle_count > max(log_thresholds)
                    and self._cycle_count % 100 == 0
                ):
                    logger.error(f"Still failing after {self._cycle_count} cycles...")
                else:
                    logger.warning(
                        f"All providers failed. Cycle {self._cycle_count}. "
                        f"Backing off for {backoff}s..."
                    )

                # Interruptible sleep
                if self._shutdown_event.wait(timeout=backoff):
                    raise Exception("Shutdown requested during failover")

        raise Exception("Shutdown requested during failover")

    def _is_rate_limit_error(self, error: Exception) -> bool:
        """Check if error is a rate limit (429) error."""
        if isinstance(error, Web3RPCError):
            error_str = str(error).lower()
            rpc_response = getattr(error, "rpc_response", {}) or {}
            error_data = rpc_response.get("error", {})
            error_code = error_data.get("code", 0)

            return (
                "429" in error_str
                or "rate" in error_str
                or "too many" in error_str
                or error_code == 429
            )
        return False

    def execute_with_failover(
        self,
        operation: Callable[[Web3], T],
    ) -> T:
        """
        Execute an operation with automatic failover on failure.

        Retries infinitely until success or shutdown signal.

        Args:
            operation: Callable that takes a Web3 instance and returns a result

        Returns:
            The result of the operation

        Raises:
            Exception: If shutdown is requested
            Other exceptions: Application errors propagate immediately
        """
        rate_limit_retried = False
        retries = 0

        while not self._shutdown_event.is_set():
            try:
                result = operation(self.get_web3())
                self._cycle_count = 0  # Reset on successful operation
                return result
            except RETRYABLE_ERRORS as e:
                retries += 1
                logger.warning(
                    f"Operation failed on {self.current_url_sanitized} "
                    f"(retry {retries}): {e}"
                )

                # Handle rate limiting with one retry
                if self._is_rate_limit_error(e) and not rate_limit_retried:
                    logger.info("Rate limited, retrying after 1s...")
                    if self._shutdown_event.wait(timeout=1):  # Interruptible 1s wait
                        raise Exception(
                            "Shutdown requested during rate limit retry"
                        ) from None
                    rate_limit_retried = True
                    continue

                # Failover for rate limit (after retry), server errors, or other errors
                rate_limit_retried = False  # Reset for next provider
                self._failover_to_next()

        raise Exception("Shutdown requested during operation execution")
