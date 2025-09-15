# ROFL Paymaster

End-to-end system for redeeming ROSE on Oasis Sapphire when users deposit
tokens on a remote EVM chain. The project combines on-chain contracts, an
off-chain relayer, and ROFL infrastructure backed by Hashi proofs.

## System Foundations

This system is built on [Hashi](https://github.com/gnosis/hashi/tree/main), a
cross-chain message verification protocol, with ROFL integration:

- **Hashi Protocol** - Cross-chain message verification framework
- **ROFL Adapter** - Part of the [ROFL Header Oracle](https://github.com/oasisprotocol/rofl-header-oracle)
  that runs in a TEE (Trusted Execution Environment) and securely pushes
  block headers from remote EVM chains to Sapphire
- **HashiProver** - Contract (`contracts/contracts/hashi/prover/HashiProver.sol`)
  that verifies Merkle proofs against the block headers provided by the ROFL
  adapter

## Components

- `contracts/` – Hardhat workspace for PaymasterVault, CrossChainPaymaster,
  supporting libraries, and deployment/configuration tasks.
- `paymaster-relayer/` – Python relayer that listens for deposits, builds Hashi
  proofs, and submits transactions locally or through ROFL.

## Operational Flows

### Manual relay

Deploy and configure the paymaster contracts, and manage vault deposits from
the `contracts/` workspace via hardhat tasks. Operators fetch block headers
(via the header oracle when available), generate a proof for each deposit, and
submit it to the Sapphire paymaster to release ROSE manually.

### Automated relayer (local)

Run the relayer stack with Docker Compose from the `paymaster-relayer/`
project. It watches the source vault, builds proofs automatically, and forwards
them to Sapphire while you iterate locally.

### Automated relayer (ROFL)

Build the relayer container image and deploy it through ROFL. The ROFL deployment
consumes the same proof pipeline but benefits from the TEE-backed header oracle
for long-lived operation without managing local infrastructure.

## Where to Go Next

- Contract deployment, configuration, and manual operation: see [`contracts/README.md`](contracts/README.md).
- Relayer setup, ROFL deployment, and local development: see [`paymaster-relayer/README.md`](paymaster-relayer/README.md).

For repository-wide conventions and linting utilities, use the top-level
`Makefile` targets.

## License

Licensed under Apache 2.0. Portions derived from the Hashi project remain
subject to the original LGPL-3.0 terms—review both licenses before redistribution.
