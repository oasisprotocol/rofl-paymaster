import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

task("deploy:mock-oracle", "Deploy Chainlink MockV3Aggregator (single feed)")
  .addOptionalParam("decimals", "Feed decimals (default 18)")
  .addOptionalParam("price", "Initial price (human-readable, default 1)")
  .setAction(async (args: { decimals?: string; price?: string }, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;

    console.log("Network:", hre.network.name);

    const decimals = parseInt(args.decimals ?? "18", 10);
    if (Number.isNaN(decimals) || decimals < 0 || decimals > 36) throw new Error("invalid decimals");
    const initial = ethers.parseUnits(args.price ?? "1", decimals);

    // Wrapper import provides the artifact name directly
    const Mock = await ethers.getContractFactory("MockV3Aggregator");
    const mock = await Mock.deploy(decimals, initial);
    await mock.waitForDeployment();
    const addr = await mock.getAddress();
    console.log("MockV3Aggregator deployed:", addr);
  });
