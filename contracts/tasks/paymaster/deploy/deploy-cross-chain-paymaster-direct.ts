import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

task(
  "deploy:cross-chain-paymaster-direct",
  "Deploy CrossChainPaymaster directly (no proxy)"
)
  .addOptionalParam("owner", "Owner address (falls back to env OWNER)")
  .addOptionalParam(
    "shoyubashi",
    "ShoyuBashi address (falls back to env SHOYU_BASHI)"
  )
  .addOptionalParam(
    "daily",
    "Daily ROSE limit (ether units, falls back to env DAILY_LIMIT_ROSE)"
  )
  .addOptionalParam(
    "pertx",
    "Per-tx ROSE limit (ether units, falls back to env PER_TX_LIMIT_ROSE)"
  )
  .addOptionalParam(
    "enabled",
    "Limits enabled true/false (falls back to env LIMITS_ENABLED)"
  )
  .addOptionalParam(
    "stale",
    "Price staleness threshold in seconds (falls back to env PRICE_STALENESS_SECONDS, default 3600)"
  )
  .addOptionalParam(
    "roseusd",
    "ROSE/USD aggregator address (falls back to env ROSE_USD_FEED)"
  )
  .setAction(
    async (
      args: {
        owner?: string;
        shoyubashi?: string;
        daily?: string;
        pertx?: string;
        enabled?: string;
        stale?: string;
        roseusd?: string;
      },
      hre: HardhatRuntimeEnvironment
    ) => {
      const { ethers } = hre;

      const owner = args.owner || process.env.OWNER;
      const shoyubashi = args.shoyubashi || process.env.SHOYU_BASHI;
      const daily = args.daily || process.env.DAILY_LIMIT_ROSE || "10000";
      const pertx = args.pertx || process.env.PER_TX_LIMIT_ROSE || "100";
      const enabledStr = (
        args.enabled ||
        process.env.LIMITS_ENABLED ||
        "true"
      ).toLowerCase();
      const enabled = enabledStr === "true";
      const staleness = parseInt(
        args.stale || process.env.PRICE_STALENESS_SECONDS || "3600",
        10
      );
      const roseUsdFeed = args.roseusd || process.env.ROSE_USD_FEED;

      if (!owner)
        throw new Error("Missing owner: pass --owner or set OWNER env");
      if (!shoyubashi)
        throw new Error(
          "Missing ShoyuBashi: pass --shoyubashi or set SHOYU_BASHI env"
        );
      if (!roseUsdFeed)
        throw new Error(
          "Missing ROSE/USD feed: pass --roseusd or set ROSE_USD_FEED env"
        );

      if (!/^0x[a-fA-F0-9]{40}$/.test(roseUsdFeed)) {
        throw new Error(`Invalid ROSE/USD feed address: ${roseUsdFeed}`);
      }

      const limits = {
        dailyLimit: ethers.parseUnits(daily, 18),
        currentDaily: 0n,
        perTxLimit: ethers.parseUnits(pertx, 18),
        lastResetDay: Math.floor(Date.now() / 1000 / 86400),
        enabled,
      };

      console.log("Network:", hre.network.name);
      console.log("Deployment type: DIRECT (no proxy)");
      console.log("Owner:", owner);
      console.log("ShoyuBashi:", shoyubashi);
      console.log("Staleness:", staleness, "seconds");
      console.log("ROSE/USD feed:", roseUsdFeed);
      console.log("Limits:", limits);

      const CrossChainPaymaster =
        await ethers.getContractFactory("CrossChainPaymaster");
      const paymaster = await CrossChainPaymaster.deploy();
      await paymaster.waitForDeployment();

      const address = await paymaster.getAddress();
      console.log("Contract deployed at:", address);

      // Initialize the contract
      console.log("Initializing contract...");
      const tx = await paymaster.initialize(
        owner,
        shoyubashi,
        limits,
        staleness,
        roseUsdFeed
      );
      await tx.wait();

      const finalOwner = await paymaster.owner();

      console.log("\nCrossChainPaymaster deployed (direct, no proxy)");
      console.log("Address:", address);
      console.log("Owner:", finalOwner);
    }
  );
