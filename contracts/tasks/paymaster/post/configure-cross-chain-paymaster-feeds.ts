import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

function requireAddress(name: string, val?: string): string {
  if (!val || !/^0x[a-fA-F0-9]{40}$/.test(val)) {
    throw new Error(`Missing or invalid ${name}: got ${val ?? "<undefined>"}`);
  }
  return val;
}

// Add ROSE/USD aggregator to CrossChainPaymaster
// Usage: bunx hardhat paymaster:add-roseusd --proxy 0x... --feed 0x...
task("paymaster:add-roseusd", "Add ROSE/USD feed to CrossChainPaymaster (supports multiple feeds for redundancy)")
  .addOptionalParam("proxy", "CrossChainPaymaster proxy address (env PAYMASTER_SAPPHIRE_PROXY)")
  .addOptionalParam("feed", "Aggregator address to add")
  .setAction(async (args: { proxy?: string; feed?: string }, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;
    const proxy = requireAddress("proxy", args.proxy ?? process.env.PAYMASTER_SAPPHIRE_PROXY);
    const feed = requireAddress("feed", args.feed);
    const paymaster = await ethers.getContractAt("CrossChainPaymaster", proxy);

    const currentCount = await paymaster.getRoseUsdFeedCount();
    console.log(`Current feed count: ${currentCount}`);
    console.log("Adding ROSE/USD feed:", feed);

    const tx = await paymaster.addRoseUsdFeed(feed);
    console.log("tx:", tx.hash);
    await tx.wait();

    const newCount = await paymaster.getRoseUsdFeedCount();
    console.log(`✅ ROSE/USD feed added (total feeds: ${newCount})`);

    if (newCount >= 3n) {
      console.log("ℹ️  Using median aggregation for outlier resistance");
    } else if (newCount === 2n) {
      console.log("ℹ️  Using mean aggregation");
    }
  });

// Remove ROSE/USD aggregator from CrossChainPaymaster
// Usage: bunx hardhat paymaster:remove-roseusd --proxy 0x... --feed 0x...
task("paymaster:remove-roseusd", "Remove ROSE/USD feed from CrossChainPaymaster")
  .addOptionalParam("proxy", "CrossChainPaymaster proxy address (env PAYMASTER_SAPPHIRE_PROXY)")
  .addOptionalParam("feed", "Aggregator address to remove")
  .setAction(async (args: { proxy?: string; feed?: string }, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;
    const proxy = requireAddress("proxy", args.proxy ?? process.env.PAYMASTER_SAPPHIRE_PROXY);
    const feed = requireAddress("feed", args.feed);
    const paymaster = await ethers.getContractAt("CrossChainPaymaster", proxy);

    // Check current feed count
    const feedCount = await paymaster.getRoseUsdFeedCount();
    console.log("Current ROSE/USD feed count:", feedCount.toString());

    if (feedCount <= 1n) {
      throw new Error("Cannot remove the last ROSE/USD feed. At least one feed must remain.");
    }

    console.log("Removing ROSE/USD feed:", feed);
    const tx = await paymaster.removeRoseUsdFeed(feed);
    console.log("tx:", tx.hash);
    await tx.wait();
    console.log("✅ ROSE/USD feed removed");
  });

// List all ROSE/USD feeds
// Usage: bunx hardhat paymaster:list-roseusd --proxy 0x...
task("paymaster:list-roseusd", "List all ROSE/USD feeds configured on CrossChainPaymaster")
  .addOptionalParam("proxy", "CrossChainPaymaster proxy address (env PAYMASTER_SAPPHIRE_PROXY)")
  .setAction(async (args: { proxy?: string }, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;
    const proxy = requireAddress("proxy", args.proxy ?? process.env.PAYMASTER_SAPPHIRE_PROXY);
    const paymaster = await ethers.getContractAt("CrossChainPaymaster", proxy);

    const feeds = await paymaster.getRoseUsdFeeds();
    console.log(`\n📋 ROSE/USD Feeds (${feeds.length} total):`);
    feeds.forEach((feed: string, index: number) => {
      console.log(`  ${index + 1}. ${feed}`);
    });
    console.log();
  });

// Wire TOKEN/USD aggregator and decimals
// Usage: bunx hardhat paymaster:set-token-feed --proxy 0x... --token 0x... --feed 0x... --decimals 6
task("paymaster:set-token-feed", "Set TOKEN/USD feed and token decimals")
  .addOptionalParam("proxy", "CrossChainPaymaster proxy address (env PAYMASTER_SAPPHIRE_PROXY)")
  .addOptionalParam("token", "Token address (env PAYMASTER_VAULT_TOKEN)")
  .addOptionalParam("feed", "Aggregator address (env TOKEN_USD_FEED)")
  .addOptionalParam("decimals", "Token decimals (env PAYMASTER_VAULT_TOKEN_DECIMALS)")
  .setAction(async (args: { proxy?: string; token?: string; feed?: string; decimals?: string }, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;
    const proxy = requireAddress("proxy", args.proxy ?? process.env.PAYMASTER_SAPPHIRE_PROXY);
    const token = requireAddress("token", args.token ?? process.env.PAYMASTER_VAULT_TOKEN);
    const feed = requireAddress("feed", args.feed ?? process.env.TOKEN_USD_FEED);
    const decStr = args.decimals ?? process.env.PAYMASTER_VAULT_TOKEN_DECIMALS ?? "18";
    const decimals = parseInt(decStr, 10);
    if (Number.isNaN(decimals) || decimals < 0 || decimals > 36) throw new Error("invalid decimals");

    const paymaster = await ethers.getContractAt("CrossChainPaymaster", proxy);
    console.log("Setting token feed:", { token, feed });
    let tx = await paymaster.setPriceFeed(token, feed);
    console.log(" setPriceFeed tx:", tx.hash);
    await tx.wait();
    console.log("Setting token decimals:", decimals);
    tx = await paymaster.setTokenDecimals(token, decimals);
    console.log(" setTokenDecimals tx:", tx.hash);
    await tx.wait();
    console.log("✅ Token feed configured");
  });

// Set staleness threshold
task("paymaster:set-staleness", "Set staleness threshold (seconds)")
  .addOptionalParam("proxy", "CrossChainPaymaster proxy address (env PAYMASTER_SAPPHIRE_PROXY)")
  .addOptionalParam("seconds", "Threshold in seconds (env PRICE_STALENESS_SECONDS)")
  .setAction(async (args: { proxy?: string; seconds?: string }, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;
    const proxy = requireAddress("proxy", args.proxy ?? process.env.PAYMASTER_SAPPHIRE_PROXY);
    const secs = parseInt(args.seconds ?? process.env.PRICE_STALENESS_SECONDS ?? "3600", 10);
    if (Number.isNaN(secs) || secs <= 0) throw new Error("invalid seconds");
    const paymaster = await ethers.getContractAt("CrossChainPaymaster", proxy);
    console.log("Setting staleness threshold:", secs, "seconds");
    const tx = await paymaster.setStalenessThreshold(secs);
    console.log("tx:", tx.hash);
    await tx.wait();
    console.log("✅ Staleness threshold set");
  });

