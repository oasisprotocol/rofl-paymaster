import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

task("deploy:paymaster-vault", "Deploy PaymasterVault (UUPS)")
  .addOptionalParam("owner", "Owner address (falls back to env PAYMASTER_VAULT_OWNER)")
  .addOptionalParam("bhr", "BlockHeaderRequester address (or set env BLOCK_HEADER_REQUESTER)")
  .setAction(async (args: { owner?: string; bhr?: string }, hre: HardhatRuntimeEnvironment) => {
    const { ethers, upgrades } = hre;

    const owner = args.owner ?? process.env.PAYMASTER_VAULT_OWNER;
    const blockHeaderRequester = args.bhr ?? process.env.BLOCK_HEADER_REQUESTER;

    if (!owner) throw new Error("Missing owner: pass --owner or set PAYMASTER_VAULT_OWNER env");
    if (!blockHeaderRequester) throw new Error("Missing BlockHeaderRequester: pass --bhr or set BLOCK_HEADER_REQUESTER env");

    console.log("Network:", hre.network.name);
    console.log("Owner:", owner);
    console.log("BlockHeaderRequester:", blockHeaderRequester);

    const PaymasterVault = await ethers.getContractFactory("PaymasterVault");
    const proxy = await upgrades.deployProxy(PaymasterVault, [owner, blockHeaderRequester], {
      kind: "uups",
      initializer: "initialize",
    });
    await proxy.waitForDeployment();

    const proxyAddress = await proxy.getAddress();
    const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

    console.log("PaymasterVault deployed as UUPS proxy");
    console.log("Proxy:", proxyAddress);
    console.log("Implementation:", implAddress);
  });
