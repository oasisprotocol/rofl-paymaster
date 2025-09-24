import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

task("upgrade:cross-chain-paymaster", "Upgrade CrossChainPaymaster UUPS proxy")
  .addOptionalParam("proxy", "Proxy address (or set PAYMASTER_SAPPHIRE_PROXY)")
  .addOptionalParam("skipcheck", "Skip storage checks (default false)")
  .setAction(async (args: { proxy?: string; skipcheck?: string }, hre: HardhatRuntimeEnvironment) => {
    const { ethers, upgrades } = hre;

    const proxy = args.proxy || process.env.PAYMASTER_SAPPHIRE_PROXY as string;
    if (!proxy) throw new Error("Missing proxy: pass --proxy or set PAYMASTER_SAPPHIRE_PROXY env");

    const unsafeSkipStorageCheck = args.skipcheck ? args.skipcheck.toLowerCase() === "true" : (process.env.RUN_VALIDATION ?? "true").toLowerCase() !== "true";

    console.log("Network:", hre.network.name);
    console.log("Proxy:", proxy);
    console.log("Skip storage check:", unsafeSkipStorageCheck);

    const CrossChainPaymaster = await ethers.getContractFactory("CrossChainPaymaster");
    const upgraded = await upgrades.upgradeProxy(proxy, CrossChainPaymaster, {
      kind: "uups",
      unsafeSkipStorageCheck,
    });
    await upgraded.waitForDeployment();

    const newImpl = await upgrades.erc1967.getImplementationAddress(proxy);
    console.log("Upgraded CrossChainPaymaster proxy");
    console.log("New implementation:", newImpl);
  });
