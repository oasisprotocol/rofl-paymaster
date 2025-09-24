import argparse
import asyncio
import logging
import sys

from .relayer import ROFLRelayer

logger = logging.getLogger(__name__)


async def main():
    """Main entry point for the Paymaster Relayer."""
    parser = argparse.ArgumentParser(description="Paymaster Relayer")
    parser.add_argument(
        "--local",
        action="store_true",
        default=False,
        help="Run in local mode without ROFL utilities",
    )
    args = parser.parse_args()

    logger.info(f"=== Paymaster Relayer Starting {'(LOCAL MODE)' if args.local else ''} ===")

    relayer = None

    try:
        relayer = ROFLRelayer.from_env(local_mode=args.local)
        await relayer.run()
    except ValueError as e:
        logger.error(f"Configuration error: {e}")
        logger.error("Required environment variables:")
        logger.error("  - SOURCE_RPC_URL: Source chain RPC endpoint (e.g., Ethereum)")
        logger.error("  - TARGET_RPC_URL: Target chain RPC endpoint (e.g., Sapphire)")
        logger.error("  - PAYMASTER_VAULT_ADDRESS: PaymasterVault contract address (source)")
        logger.error("  - PAYMASTER_PROXY_ADDRESS: CrossChainPaymaster contract address (target)")
        logger.error("  - ROFL_ADAPTER_ADDRESS: ROFLAdapter contract address (target, HashStored)")
        if args.local:
            logger.error("  - PRIVATE_KEY: Private key for signing transactions")
        sys.exit(1)
    except KeyboardInterrupt:
        logger.info("Received interrupt signal, shutting down...")
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        sys.exit(1)
    finally:
        if relayer is not None:
            logger.debug("Stopping relayer...")
            relayer.stop()


if __name__ == "__main__":
    asyncio.run(main())
