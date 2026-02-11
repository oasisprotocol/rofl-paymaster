# Paymaster Relayer

Automated relay that watches PaymasterVault `PaymentInitiated` events on the
source chain and submits Hashi receipt proofs to `CrossChainPaymaster` on
Oasis Sapphire.

## Quick Start

### Configure Environment

```shell
cp .env.example .env
# Edit .env with your contract addresses and RPC URL
```

### Run Locally with Make

```shell
# From paymaster-relayer/
make run-local
```

The `run-local` target wraps `docker compose -f compose.local.yaml up --build`
so you always have the latest image when testing locally.

### Build & Push (optional)

```shell
docker compose build --push
```

### Rebuild for ROFL

```shell
make rofl-rebuild
```

This target rebuilds the Docker image, runs `oasis rofl build`, and updates the
ROFL deployment in one go.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SOURCE_RPC_URLS` | Yes | Source chain RPC endpoints (comma-separated for failover) |
| `PAYMASTER_VAULT_ADDRESS` | Yes | PaymasterVault contract address on source chain |
| `TARGET_RPC_URL` | Yes | Sapphire RPC endpoint |
| `PAYMASTER_PROXY_ADDRESS` | Yes | CrossChainPaymaster proxy address on Sapphire |
| `ROFL_ADAPTER_ADDRESS` | Yes | ROFLAdapter on Sapphire to monitor `HashStored` |
| `PRIVATE_KEY` | Local only | Private key for signing transactions (non-ROFL mode) |

## Testing

Run the test suite to verify the relayer functionality:

```shell
# Run tests
make test

# Watch mode (if installed)
make test-watch
```

The test suite validates:

- PollingEventListener utility class structure
- ROFL Relayer initialization and event monitoring
- Integration with deployed contracts on Ethereum Sepolia
