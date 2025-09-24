# ROFL Paymaster Hardhat Workspace

Cross-chain system for redeeming ROSE on Oasis Sapphire when users deposit
ERC20 tokens on a remote EVM chain.

## Overview

The ROFL Paymaster enables users to:

- Deposit ERC20 tokens (USDC, USDT, etc.) on source chains (e.g., Base Sepolia)
- Receive equivalent value in ROSE on Oasis Sapphire
- Bridge value across chains without centralized intermediaries

### System Components

- PaymasterVault (source chain): accepts ERC20 deposits and emits
  Hashi-verifiable events
- CrossChainPaymaster (Sapphire): verifies proofs and distributes ROSE
- Shoyushelli/Adapter: stores canonical block header hashes used for proof verification
- ROFL Relayer (off-chain): monitors deposits, generates inclusion proofs,
  submits to Sapphire

### Networks (Hardhat names)

- `eth-sepolia` (Ethereum Sepolia)
- `base-sepolia` (Base testnet)
- `sapphire-testnet` (Oasis Sapphire testnet)

## Quick Start

```shell
# In this contracts/ directory
bun install

# Compile
bun hardhat compile

# Configure env (see variables below)
cp .env.example .env
# Edit .env
```

## Environment Variables (contracts)

| Variable | Required | Description |
|----------|----------|-------------|
| `PRIVATE_KEY` | No | Deployer/signing key for Hardhat networks; defaults to test mnemonic if unset. |
| `ALCHEMY_API_KEY` | No | Used for Hardhat mainnet fork and default RPC hints in `post-blockhash`. |
| `OWNER` | Yes | Owner address for `deploy:cross-chain-paymaster`. |
| `PRICE_ORACLE` | Yes | Price oracle address on Sapphire; used by deploy and oracle config tasks. |
| `SHOYU_shellI` | Yes | Shoyushelli address on Sapphire. |
| `DAILY_LIMIT_ROSE` | No | Daily ROSE distribution limit for CrossChainPaymaster (default `10000`). |
| `PER_TX_LIMIT_ROSE` | No | Per-transaction ROSE limit for CrossChainPaymaster (default `100`). |
| `LIMITS_ENABLED` | No | Enable/disable distribution limits (default `true`). |
| `PAYMASTER_VAULT_OWNER` | Yes | Owner address for `deploy:paymaster-vault`. |
| `BLOCK_HEADER_REQUESTER` | Yes | BlockHeaderRequester address for `deploy:paymaster-vault`. |
| `PAYMASTER_VAULT_PROXY` | Yes (upgrade/config) | PaymasterVault proxy address for upgrade/config tasks. |
| `PAYMASTER_SAPPHIRE_PROXY` | Yes (upgrade/config) | CrossChainPaymaster proxy address on Sapphire for upgrade/config tasks. |
| `RUN_VALIDATION` | No | Upgrade storage check: `true` to validate (default), `false` to skip. |
| `PAYMASTER_SAPPHIRE_SOURCE_CHAIN_ID` | Yes (configure) | Source chain ID for `configure:cross-chain-paymaster` (e.g., `11155111` for Sepolia). |
| `PAYMASTER_SAPPHIRE_CHAIN_ENABLED` | No | Enable/disable source chain (default `true`). |
| `PAYMASTER_SAPPHIRE_CONFIRMATIONS` | No | Required confirmations on source chain (default `0`). |
| `PAYMASTER_SAPPHIRE_BLOCK_TIME` | No | Avg source block time seconds (default `2`). |
| `PAYMASTER_SAPPHIRE_MAX_ROSE` | No | Max per-tx ROSE for a configured source chain. |
| `PAYMASTER_SAPPHIRE_AUTHORIZE_VAULT` | No | Authorize/deauthorize source vault (default `true`). |
| `PAYMASTER_VAULT_TOKEN` | No | Token address for vault config and oracle tasks. |
| `PAYMASTER_VAULT_TOKEN_DECIMALS` | No (required when token set) | Token decimals for vault config/oracle tasks. |
| `PAYMASTER_VAULT_TOKEN_MIN` | No | Min deposit amount (whole tokens; parsed with decimals). |
| `PAYMASTER_VAULT_TOKEN_MAX` | No | Max deposit amount (whole tokens; parsed with decimals). |
| `PAYMASTER_VAULT_TOKEN_DAILY_LIMIT` | No | Per-token daily deposit limit (whole tokens; parsed with decimals). |
| `PAYMASTER_VAULT_BREAKER_ENABLED` | No | Enable per-token circuit breaker (default `true`). |

Note: `SOURCE_RPC_URL`/`TARGET_RPC_URL` are used by the relayer
(see `paymaster-relayer/README.md`), not by Hardhat.

## Deployment

### 1) Deploy CrossChainPaymaster (Sapphire)

```shell
# Basic (uses env)
bun hardhat deploy:cross-chain-paymaster --network sapphire-testnet

# Custom params
bun hardhat deploy:cross-chain-paymaster \
  --owner 0x... \
  --oracle 0x... \
  --shoyushelli 0x... \
  --daily 50000 \
  --pertx 500 \
  --enabled true \
  --network sapphire-testnet
```

Outputs the proxy (main address), implementation, and owner.

### 2) Deploy PaymasterVault (source chain)

```shell
# Basic (uses env)
bun hardhat deploy:paymaster-vault --network eth-sepolia

# Custom params
bun hardhat deploy:paymaster-vault \
  --owner 0x... \
  --bhr 0x... \
  --network eth-sepolia
```

### 3) Deploy Mock Oracle (testing)

```shell
bun hardhat deploy:mock-oracle \
  --paymaster 0x<PAYMASTER_PROXY> \
  --network sapphire-testnet
```

## Configuration

### CrossChainPaymaster (Sapphire)

```shell
# Configure chain + authorize vault
bun hardhat configure:cross-chain-paymaster \
  --proxy 0x<PAYMASTER_PROXY> \
  --chainid 11155111 \
  --vault 0x<VAULT_ADDRESS> \
  --authorize true \
  --enabled true \
  --confirmations 12 \
  --blocktime 2 \
  --maxrose 1000 \
  --network sapphire-testnet

# Update distribution limits
bun hardhat configure:cross-chain-paymaster \
  --proxy 0x<PAYMASTER_PROXY> \
  --daily 100000 \
  --pertx 1000 \
  --limitsenabled true \
  --network sapphire-testnet
```

### PaymasterVault (source chain)

```shell
# Example: USDC (6 decimals)
bun hardhat configure:paymaster-vault \
  --proxy 0x<VAULT_PROXY> \
  --token 0x<USDC_ADDRESS> \
  --decimals 6 \
  --min 10 \
  --max 10000 \
  --dailylimit 50000 \
  --breakerenabled true \
  --network eth-sepolia
```

### Mock Oracle (testing)

```shell
# Add token feed at price=1 ROSE
bun hardhat oracle:addtokenfeed \
  --oracle 0x<ORACLE_ADDRESS> \
  --token 0x<USDC_ADDRESS> \
  --decimals 6 \
  --price 1 \
  --network sapphire-testnet

# Remove token feed
bun hardhat oracle:removetokenfeed \
  --oracle 0x<ORACLE_ADDRESS> \
  --token 0x<USDC_ADDRESS> \
  --network sapphire-testnet
```

## Flow: Deposit → Proof → Relay

### 1) User deposits tokens (source chain)

```shell
# Auto-approves if needed (omit with --noapprove)
bun hardhat pay:deposit \
  --vault 0x<VAULT_PROXY> \
  --token 0x<USDC_ADDRESS> \
  --amount 100 \
  --recipient 0x<USER_SAPPHIRE_ADDRESS> \
  --network eth-sepolia
```

Emits `PaymentInitiated(payer, recipient, token, amount, paymentId)` and `TokenDeposited`.
Note: The canonical paymentId used on Sapphire is derived from proof metadata
`keccak256(chainId, vault, blockNumber, txIndex, logIndex)`.

### 2) Store block hash on Sapphire (testing only)

```shell
# Post block hash to mock adapter/Shoyushelli
bun hardhat post-blockhash \
  --chainId 11155111 \
  --blockNumber 12345678 \
  --blockHash 0x... \
  --contract 0x<MOCK_CONTRACT> \
  --type shoyushelli \
  --network sapphire-testnet

# Or fetch from a source RPC (omit --blockHash)
bun hardhat post-blockhash \
  --chainId 11155111 \
  --blockNumber 12345678 \
  --sourceRpc https://rpc.sepolia.org \
  --contract 0x<MOCK_CONTRACT> \
  --type adapter \
  --network sapphire-testnet
```

### 3) Generate inclusion proof (source chain)

```shell
bun hardhat pay:generate-proof \
  --tx-hash 0x<DEPOSIT_TX_HASH> \
  --network eth-sepolia
# Saves JSON array to proof.json
```

### 4) Relay payment to Sapphire

```shell
bun hardhat pay:relay \
  --paymaster 0x<PAYMASTER_PROXY> \
  --proof proof.json \
  --network sapphire-testnet

# Inline proof alternative
bun hardhat pay:relay \
  --paymaster 0x<PAYMASTER_PROXY> \
  --proof "$(cat proof.json)" \
  --network sapphire-testnet
```

CrossChainPaymaster will verify the event via Hashi, prevent duplicates,
enforce limits,
convert via oracle, and transfer ROSE to the recipient.

## Automated Relayer

```shell
cd ../paymaster-relayer
cp .env.example .env  # edit values

# Local development
docker compose -f compose.local.yaml up
# Or deploy to ROFL (production/ROFL)
```

See `paymaster-relayer/README.md` for details.

## Upgrades (UUPS)

```shell
# CrossChainPaymaster
bun hardhat upgrade:cross-chain-paymaster \
  --proxy 0x<PAYMASTER_PROXY> \
  --network sapphire-testnet

# PaymasterVault
bun hardhat upgrade:paymaster-vault \
  --proxy 0x<VAULT_PROXY> \
  --network eth-sepolia

# Skip storage checks (use with caution)
bun hardhat upgrade:cross-chain-paymaster \
  --proxy 0x<PAYMASTER_PROXY> \
  --skipcheck true \
  --network sapphire-testnet
```

## Acknowledgments

Portions of this project build on smart contracts from the Hashi repository
maintained by Gnosis Guild: <https://github.com/gnosis/hashi>. Those components
retain the original LGPL-3.0 licensing from upstream; review the Hashi license
alongside this project's Apache-2.0 terms when using or distributing the
combined work.
