"""
Configuration for the Paymaster relayer.

This module provides dataclasses for managing configuration of the relayer
that monitors PaymentInitiated events on the source chain and relays proofs
to CrossChainPaymaster on Oasis Sapphire.
"""

import os
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class SourceChainConfig:
    """Configuration for the source chain (e.g., Base/Sepolia)."""

    rpc_url: str
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
        # Source chain configuration
        source_rpc_url = os.environ.get("SOURCE_RPC_URL")
        if not source_rpc_url:
            raise ValueError(
                "SOURCE_RPC_URL environment variable is required. "
                "Example: https://ethereum-sepolia.publicnode.com"
            )

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

        # Monitoring configuration with hard-coded defaults
        monitoring_config = MonitoringConfig()

        # Create configuration objects
        source_chain = SourceChainConfig(
            rpc_url=source_rpc_url,
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
        print(f"  RPC URL: {self.source_chain.rpc_url}")
        print(f"  PaymasterVault: {self.source_chain.paymaster_vault_address}")

        print("\n[Target Chain]")
        print(f"  RPC URL: {self.target_chain.rpc_url}")
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
        print("===================================\n")
