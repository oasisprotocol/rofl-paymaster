"""
Configuration for the Paymaster relayer.

This module provides dataclasses for managing configuration of the relayer
that monitors PaymentInitiated events on the source chain and relays proofs
to CrossChainPaymaster on Oasis Sapphire.
"""

import os
from dataclasses import dataclass, field

from .utils.multi_rpc_provider import sanitize_url


def parse_rpc_urls() -> list[str]:
    """
    Parse SOURCE_RPC_URLS env var into a list of RPC endpoint URLs.

    Splits on commas, strips whitespace, and filters empty entries.

    Returns:
        List of non-empty, trimmed URLs

    Raises:
        ValueError: If SOURCE_RPC_URLS is missing or contains no valid URLs
    """
    raw = os.environ.get("SOURCE_RPC_URLS", "")
    urls = [url.strip() for url in raw.split(",") if url.strip()]

    if not urls:
        raise ValueError("SOURCE_RPC_URLS environment variable is missing or empty")

    return urls


@dataclass(frozen=True, slots=True)
class SourceChainConfig:
    """Configuration for the source chain (e.g., Base/Sepolia)."""

    rpc_urls: list[str]
    paymaster_vault_address: str


@dataclass(frozen=True, slots=True)
class TargetChainConfig:
    """Configuration for the target chain (Oasis Sapphire)."""

    rpc_url: str
    paymaster_address: str
    rofl_adapter_address: str
    private_key: str | None


@dataclass(frozen=True, slots=True)
class MonitoringConfig:
    """Configuration for event monitoring and processing."""

    # Hard-coded sensible defaults for MVP
    polling_interval: int = 12  # seconds
    retry_count: int = 3
    lookback_blocks: int = 9
    process_batch_size: int = 10  # max events to process in one batch
    max_block_range: int = (
        10  # max blocks per get_logs request (Alchemy free tier limit)
    )

    def __post_init__(self) -> None:
        """Validate monitoring configuration."""
        # Validate polling interval
        if self.polling_interval <= 0:
            raise ValueError(
                f"Polling interval must be positive, got {self.polling_interval}"
            )
        if self.polling_interval > 300:
            raise ValueError(
                f"Polling interval too long (max 300s), got {self.polling_interval}"
            )

        # Validate retry count
        if self.retry_count < 0:
            raise ValueError(
                f"Retry count must be non-negative, got {self.retry_count}"
            )
        if self.retry_count > 10:
            raise ValueError(f"Retry count too high (max 10), got {self.retry_count}")

        # Validate lookback blocks
        if self.lookback_blocks <= 0:
            raise ValueError(
                f"Lookback blocks must be positive, got {self.lookback_blocks}"
            )
        if self.lookback_blocks > 1000:
            raise ValueError(
                f"Lookback blocks too high (max 1000), got {self.lookback_blocks}"
            )

        # Validate batch size
        if self.process_batch_size <= 0:
            raise ValueError(
                f"Batch size must be positive, got {self.process_batch_size}"
            )
        if self.process_batch_size > 100:
            raise ValueError(
                f"Batch size too large (max 100), got {self.process_batch_size}"
            )

        # Validate max block range
        if self.max_block_range <= 0:
            raise ValueError(
                f"Max block range must be positive, got {self.max_block_range}"
            )
        if self.max_block_range > 10000:
            raise ValueError(
                f"Max block range too large (max 10000), got {self.max_block_range}"
            )


@dataclass(frozen=True, slots=True)
class RelayerConfig:
    """Main configuration class for the ROFL Relayer."""

    source_chain: SourceChainConfig
    target_chain: TargetChainConfig
    monitoring: MonitoringConfig = field(default_factory=MonitoringConfig)
    local_mode: bool = False

    @classmethod
    def from_env(cls, local_mode: bool = False) -> "RelayerConfig":
        """
        Load configuration from environment variables.

        Returns:
            RelayerConfig: Configured relayer instance

        Raises:
            ValueError: If required environment variables are missing
        """
        # Source chain configuration - parse comma-delimited RPC URLs
        try:
            source_rpc_urls = parse_rpc_urls()
        except ValueError:
            raise ValueError(
                "SOURCE_RPC_URLS environment variable is required (comma-separated). "
                "Example: SOURCE_RPC_URLS=https://rpc1.example.com,https://rpc2.example.com"
            ) from None

        paymaster_vault_address = os.environ.get("PAYMASTER_VAULT_ADDRESS")
        if not paymaster_vault_address:
            raise ValueError(
                "PAYMASTER_VAULT_ADDRESS environment variable is required. "
                "This is the address of the deployed PaymasterVault contract on the source chain"
            )

        # Target chain configuration
        target_rpc_url = os.environ.get("TARGET_RPC_URL")
        if not target_rpc_url:
            raise ValueError(
                "TARGET_RPC_URL environment variable is required. "
                "Example: https://testnet.sapphire.oasis.io"
            )

        paymaster_address = os.environ.get("PAYMASTER_PROXY_ADDRESS") or os.environ.get(
            "PAYMASTER_ADDRESS"
        )
        if not paymaster_address:
            raise ValueError(
                "PAYMASTER_PROXY_ADDRESS (or PAYMASTER_ADDRESS) environment variable is required. "
                "This is the address of the CrossChainPaymaster contract on Sapphire"
            )

        rofl_adapter_address = os.environ.get("ROFL_ADAPTER_ADDRESS")
        if not rofl_adapter_address:
            raise ValueError(
                "ROFL_ADAPTER_ADDRESS environment variable is required. "
                "This is the address of the ROFLAdapter contract for monitoring HashStored events"
            )

        private_key = os.environ.get("PRIVATE_KEY")
        if not private_key and local_mode:
            raise ValueError(
                "PRIVATE_KEY environment variable is required in local mode. "
                "This is used to sign transactions on the target chain"
            )

        # Monitoring configuration - parse optional env vars with defaults
        polling_interval = int(os.environ.get("POLLING_INTERVAL", "12"))
        retry_count = int(os.environ.get("RETRY_COUNT", "3"))
        lookback_blocks = int(os.environ.get("LOOKBACK_BLOCKS", "9"))
        process_batch_size = int(os.environ.get("PROCESS_BATCH_SIZE", "10"))
        max_block_range = int(os.environ.get("MAX_BLOCK_RANGE", "10"))

        monitoring_config = MonitoringConfig(
            polling_interval=polling_interval,
            retry_count=retry_count,
            lookback_blocks=lookback_blocks,
            process_batch_size=process_batch_size,
            max_block_range=max_block_range,
        )

        # Create configuration objects
        source_chain = SourceChainConfig(
            rpc_urls=source_rpc_urls,
            paymaster_vault_address=paymaster_vault_address,
        )

        target_chain = TargetChainConfig(
            rpc_url=target_rpc_url,
            paymaster_address=paymaster_address,
            rofl_adapter_address=rofl_adapter_address,
            private_key=private_key,
        )

        return cls(
            source_chain=source_chain,
            target_chain=target_chain,
            monitoring=monitoring_config,
            local_mode=local_mode,
        )

    def log_config(self) -> None:
        """Log configuration settings (hiding sensitive data)."""
        print("\n=== ROFL Relayer Configuration ===")
        print(f"Mode: {'LOCAL' if self.local_mode else 'ROFL'}")

        print("\n[Source Chain]")
        print(f"  RPC URLs ({len(self.source_chain.rpc_urls)} configured):")
        for i, url in enumerate(self.source_chain.rpc_urls, 1):
            print(f"    [{i}] {sanitize_url(url)}")
        print(f"  PaymasterVault: {self.source_chain.paymaster_vault_address}")

        print("\n[Target Chain]")
        print(f"  RPC URL: {sanitize_url(self.target_chain.rpc_url)}")
        print(f"  CrossChainPaymaster: {self.target_chain.paymaster_address}")
        print(f"  ROFLAdapter: {self.target_chain.rofl_adapter_address}")
        print(
            f"  Private Key: {'[SET]' if self.target_chain.private_key else '[NOT SET]'}"
        )

        print("\n[Monitoring Settings]")
        print(f"  Polling Interval: {self.monitoring.polling_interval}s")
        print(f"  Retry Count: {self.monitoring.retry_count}")
        print(f"  Lookback Blocks: {self.monitoring.lookback_blocks}")
        print(f"  Batch Size: {self.monitoring.process_batch_size}")
        print(f"  Max Block Range: {self.monitoring.max_block_range}")
        print("===================================\n")
