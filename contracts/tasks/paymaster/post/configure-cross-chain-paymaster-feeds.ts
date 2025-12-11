import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

function requireAddress(name: string, val?: string): string {
  if (!val || !/^0x[a-fA-F0-9]{40}$/.test(val)) {
    throw new Error(`Missing or invalid ${name}: got ${val ?? "<undefined>"}`);
  }
  return val;
}

// Set ROSE/USD aggregator on CrossChainPaymaster
// Usage: bunx hardhat paymaster:set-roseusd --proxy 0x... --feed 0x...
task("paymaster:set-roseusd", "Set ROSE/USD feed on CrossChainPaymaster")
  .addOptionalParam("proxy", "CrossChainPaymaster proxy address (env PAYMASTER_SAPPHIRE_PROXY)")
  .addOptionalParam("feed", "Aggregator address to set (env ROSE_USD_FEED)")
  .setAction(async (args: { proxy?: string; feed?: string }, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;
    const proxy = requireAddress("proxy", args.proxy ?? process.env.PAYMASTER_SAPPHIRE_PROXY);
    const feed = requireAddress("feed", args.feed ?? process.env.ROSE_USD_FEED);
    const paymaster = await ethers.getContractAt("CrossChainPaymaster", proxy);

    const currentFeed = await paymaster.roseUsdFeed();
    console.log("Current ROSE/USD feed:", currentFeed);
    console.log("Setting ROSE/USD feed:", feed);

    const tx = await paymaster.setRoseUsdFeed(feed);
    console.log("tx:", tx.hash);
    await tx.wait();

    console.log("✅ ROSE/USD feed updated");
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

    // Read current state
    const currentFeed = await paymaster.priceFeeds(token);
    const currentDecimals = await paymaster.tokenDecimals(token);

    console.log("Current token feed:    ", currentFeed);
    console.log("Current token decimals:", currentDecimals);
    console.log("Requested feed:        ", feed);
    console.log("Requested decimals:    ", decimals);

    const feedMatches = currentFeed.toLowerCase() === feed.toLowerCase();
    const decimalsMatch = Number(currentDecimals) === decimals;

    // Skip if both already configured
    if (feedMatches && decimalsMatch) {
      console.log("ℹ️  Token feed and decimals already set to requested values");
      console.log("✅ Token feed configuration unchanged (already correct)");
      return;
    }

    // Update feed if needed
    if (feedMatches) {
      console.log("ℹ️  Token feed already set to requested value, skipping setPriceFeed");
    } else {
      console.log("Setting token feed:", feed);
      const tx = await paymaster.setPriceFeed(token, feed);
      console.log(" setPriceFeed tx:", tx.hash);
      await tx.wait();
    }

    // Update decimals if needed
    if (decimalsMatch) {
      console.log("ℹ️  Token decimals already set to requested value, skipping setTokenDecimals");
    } else {
      console.log("Setting token decimals:", decimals);
      const tx = await paymaster.setTokenDecimals(token, decimals);
      console.log(" setTokenDecimals tx:", tx.hash);
      await tx.wait();
    }

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
