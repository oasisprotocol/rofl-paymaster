import { ethers } from "hardhat";
import { parseEther } from "ethers";
import {
  TestCrossChainPaymaster,
  MockV3Aggregator,
  MockToken,
} from "../../typechain-types";
import {
  DECIMALS_8,
  DECIMALS_18,
  STALENESS_THRESHOLD,
  DAILY_LIMIT,
  PER_TX_LIMIT,
  USD_PRICE_8_DECIMALS,
  ROSE_PRICE_8_DECIMALS,
} from "../helpers/constants";

/**
 * Deployment fixture for CrossChainPaymaster tests
 * Uses single ROSE/USD feed (aggregated by ROFL oracle off-chain)
 */
export async function deployTestCrossChainPaymasterFixture() {
  const [owner, user1, user2, vault1] = await ethers.getSigners();

  // Deploy mock ShoyuBashi (simplified - just an address for initialization)
  const mockShoyuBashi = user2.address; // Using user2 address as mock

  // Deploy ROSE/USD price feed (single aggregated feed)
  const MockV3AggregatorFactory = await ethers.getContractFactory("contracts/test/mocks/MockV3Aggregator.sol:MockV3Aggregator");

  const roseUsdFeed = await MockV3AggregatorFactory.deploy(
    DECIMALS_8,
    ROSE_PRICE_8_DECIMALS
  );
  await roseUsdFeed.waitForDeployment();

  // Deploy token/USD price feed
  const tokenUsdFeed = await MockV3AggregatorFactory.deploy(
    DECIMALS_8,
    USD_PRICE_8_DECIMALS
  );
  await tokenUsdFeed.waitForDeployment();

  // Deploy mock token
  const MockTokenFactory = await ethers.getContractFactory("MockToken");
  const mockToken = await MockTokenFactory.deploy("Mock USDC", "USDC", 6);
  await mockToken.waitForDeployment();

  // Deploy TestCrossChainPaymaster (upgradeable)
  const TestCrossChainPaymasterFactory = await ethers.getContractFactory(
    "TestCrossChainPaymaster"
  );

  const distributionLimits = {
    dailyLimit: DAILY_LIMIT,
    perTxLimit: PER_TX_LIMIT,
    lastResetDay: 0,
    currentDaily: 0,
    enabled: true,
  };

  // Deploy as a regular contract for testing (no proxy needed)
  const paymaster = await TestCrossChainPaymasterFactory.deploy();
  await paymaster.waitForDeployment();

  // Call initialize with single ROSE/USD feed
  await paymaster.initialize(
    owner.address,
    mockShoyuBashi,
    distributionLimits,
    STALENESS_THRESHOLD,
    await roseUsdFeed.getAddress()
  );

  // Set up token price feed
  const tokenAddress = await mockToken.getAddress();
  const tokenUsdFeedAddress = await tokenUsdFeed.getAddress();
  await paymaster.setPriceFeed(tokenAddress, tokenUsdFeedAddress);

  // Set token decimals
  await paymaster.setTokenDecimals(tokenAddress, 6);

  // Fund the paymaster with ROSE
  await owner.sendTransaction({
    to: await paymaster.getAddress(),
    value: parseEther("100"), // 100 ROSE
  });

  return {
    paymaster,
    roseUsdFeed,
    tokenUsdFeed,
    mockToken,
    owner,
    user1,
    user2,
    vault1,
  };
}

/**
 * Simpler fixture alias (now identical to main fixture)
 */
export async function deploySimpleTestFixture() {
  return deployTestCrossChainPaymasterFixture();
}
