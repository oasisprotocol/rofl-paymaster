import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { getDeploymentInfo, deployUUPSProxy } from "../../../lib/deterministic-deployer";

task(
  "deploy:paymaster-vault:deterministic",
  "Deploy PaymasterVault with deterministic address via CreateX CREATE3"
)
  .addParam("salt", "Deployment salt (e.g., 'paymaster-vault-v1')")
  .addOptionalParam(
    "owner",
    "Owner address (falls back to env PAYMASTER_VAULT_OWNER)"
  )
  .addOptionalParam(
    "bhr",
    "BlockHeaderRequester address (or set env BLOCK_HEADER_REQUESTER)"
  )
  .setAction(
    async (
      args: { salt: string; owner?: string; bhr?: string },
      hre: HardhatRuntimeEnvironment
    ) => {
      const owner = args.owner ?? process.env.PAYMASTER_VAULT_OWNER;
      const blockHeaderRequester =
        args.bhr ?? process.env.BLOCK_HEADER_REQUESTER;

      // Get signer once - used for all operations
      const [signer] = await hre.ethers.getSigners();
      const info = await getDeploymentInfo(signer, args.salt);

      console.log("\n═══════════════════════════════════════════════════════════");
      console.log("  PaymasterVault Deterministic Deployment (CreateX CREATE3)");
      console.log("═══════════════════════════════════════════════════════════");
      console.log(`Network: ${hre.network.name}`);
      console.log(`Chain ID: ${(await hre.ethers.provider.getNetwork()).chainId}`);
      console.log(`Salt: ${args.salt}`);
      console.log(`Deployer: ${info.deployer}`);
      console.log("═══════════════════════════════════════════════════════════\n");

      // Validate required params for deployment
      if (!owner) {
        throw new Error(
          "Missing owner: pass --owner or set PAYMASTER_VAULT_OWNER env"
        );
      }
      if (!blockHeaderRequester) {
        throw new Error(
          "Missing BlockHeaderRequester: pass --bhr or set BLOCK_HEADER_REQUESTER env"
        );
      }

      console.log("Configuration:");
      console.log(`  Owner: ${owner}`);
      console.log(`  BlockHeaderRequester: ${blockHeaderRequester}`);

      // Deploy with validation
      const result = await deployUUPSProxy(
        hre,
        signer,
        "PaymasterVault",
        args.salt,
        [owner, blockHeaderRequester]
      );

      console.log("\n═══════════════════════════════════════════════════════════");
      console.log("  Deployment Complete");
      console.log("═══════════════════════════════════════════════════════════");
      console.log(`Proxy:          ${result.proxy}`);
      console.log(`Implementation: ${result.implementation}`);
      console.log(`Impl Tx:        ${result.implTx.hash}`);
      console.log(`Proxy Tx:       ${result.proxyTx.hash}`);
      console.log("═══════════════════════════════════════════════════════════");
      console.log("\n✨ Same salt + deployer = same addresses on any chain");
      console.log("═══════════════════════════════════════════════════════════\n");

      return result;
    }
  );
