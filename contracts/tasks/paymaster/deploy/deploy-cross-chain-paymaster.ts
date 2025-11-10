import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

task("deploy:cross-chain-paymaster", "Deploy CrossChainPaymaster (UUPS)")
  .addOptionalParam("owner", "Owner address (falls back to env OWNER)")
  .addOptionalParam("shoyubashi", "ShoyuBashi address (falls back to env SHOYU_BASHI)")
  .addOptionalParam("daily", "Daily ROSE limit (ether units, falls back to env DAILY_LIMIT_ROSE)")
  .addOptionalParam("pertx", "Per-tx ROSE limit (ether units, falls back to env PER_TX_LIMIT_ROSE)")
  .addOptionalParam("enabled", "Limits enabled true/false (falls back to env LIMITS_ENABLED)")
  .addOptionalParam("stale", "Price staleness threshold in seconds (falls back to env PRICE_STALENESS_SECONDS, default 3600)")
  .addOptionalParam("roseusd", "ROSE/USD aggregator addresses - comma-separated (falls back to env ROSE_USD_FEEDS)")
  .setAction(async (args: {
    owner?: string;
    shoyubashi?: string;
    daily?: string;
    pertx?: string;
    enabled?: string;
    stale?: string;
    roseusd?: string;
  }, hre: HardhatRuntimeEnvironment) => {
    const { ethers, upgrades } = hre;

    const owner = args.owner || process.env.OWNER;
    const shoyubashi = args.shoyubashi || process.env.SHOYU_BASHI;
    const daily = args.daily || process.env.DAILY_LIMIT_ROSE || "10000";
    const pertx = args.pertx || process.env.PER_TX_LIMIT_ROSE || "100";
    const enabledStr = (args.enabled || process.env.LIMITS_ENABLED || "true").toLowerCase();
    const enabled = enabledStr === "true";
    const staleness = parseInt(args.stale || process.env.PRICE_STALENESS_SECONDS || "3600", 10);
    const roseUsdParam = args.roseusd || process.env.ROSE_USD_FEEDS;

    if (!owner) throw new Error("Missing owner: pass --owner or set OWNER env");
    if (!shoyubashi) throw new Error("Missing ShoyuBashi: pass --shoyubashi or set SHOYU_BASHI env");
    if (!roseUsdParam) throw new Error("Missing ROSE/USD feeds: pass --roseusd (comma-separated) or set ROSE_USD_FEEDS env");

    // Parse comma-separated feed addresses
    const roseUsdFeeds = roseUsdParam.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0);

    // Validate all addresses
    for (const feed of roseUsdFeeds) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(feed)) {
        throw new Error(`Invalid ROSE/USD feed address: ${feed}`);
      }
    }

    if (roseUsdFeeds.length === 0) {
      throw new Error("At least one ROSE/USD feed address is required");
    }

    // Warn if only single feed provided (reduced redundancy)
    if (roseUsdFeeds.length === 1) {
      console.warn("⚠️  WARNING: Only 1 ROSE/USD feed configured. For production, configure multiple feeds for redundancy and outlier resistance.");
    } else if (roseUsdFeeds.length === 2) {
      console.log(`✓ Configuring ${roseUsdFeeds.length} feeds (mean aggregation)`);
    } else {
      console.log(`✓ Configuring ${roseUsdFeeds.length} feeds (median aggregation for outlier resistance)`);
    }

    const limits = {
      dailyLimit: ethers.parseUnits(daily, 18),
      currentDaily: 0n,
      perTxLimit: ethers.parseUnits(pertx, 18),
      lastResetDay: Math.floor(Date.now() / 1000 / 86400),
      enabled,
    };

    console.log("Network:", hre.network.name);
    console.log("Owner:", owner);
    console.log("ShoyuBashi:", shoyubashi);
    console.log("Staleness:", staleness, "seconds");
    console.log("ROSE/USD feeds:", roseUsdFeeds);
    console.log("Limits:", limits);

    const CrossChainPaymaster = await ethers.getContractFactory("CrossChainPaymaster");
    const proxy = await upgrades.deployProxy(
      CrossChainPaymaster,
      [owner, shoyubashi, limits, staleness, roseUsdFeeds],
      { kind: "uups", initializer: "initialize" }
    );

    await proxy.waitForDeployment();
    const proxyAddress = await proxy.getAddress();
    const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

    const paymaster = await ethers.getContractAt("CrossChainPaymaster", proxyAddress);
    const finalOwner = await paymaster.owner();

    console.log("CrossChainPaymaster deployed as UUPS proxy");
    console.log("Proxy:", proxyAddress);
    console.log("Implementation:", implAddress);
    console.log("Owner:", finalOwner);
  });
