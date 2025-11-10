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
 */
export async function deployTestCrossChainPaymasterFixture() {
  const [owner, user1, user2, vault1] = await ethers.getSigners();

  // Deploy mock ShoyuBashi (simplified - just an address for initialization)
  const mockShoyuBashi = user2.address; // Using user2 address as mock

  // Deploy ROSE/USD price feeds
  const MockV3AggregatorFactory = await ethers.getContractFactory("contracts/test/mocks/MockV3Aggregator.sol:MockV3Aggregator");

  const roseUsdFeed1 = await MockV3AggregatorFactory.deploy(
    DECIMALS_8,
    ROSE_PRICE_8_DECIMALS
  );
  await roseUsdFeed1.waitForDeployment();

  const roseUsdFeed2 = await MockV3AggregatorFactory.deploy(
    DECIMALS_8,
    ROSE_PRICE_8_DECIMALS
  );
  await roseUsdFeed2.waitForDeployment();

  const roseUsdFeed3 = await MockV3AggregatorFactory.deploy(
    DECIMALS_8,
    ROSE_PRICE_8_DECIMALS
  );
  await roseUsdFeed3.waitForDeployment();

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

  const roseUsdFeeds = [
    await roseUsdFeed1.getAddress(),
    await roseUsdFeed2.getAddress(),
    await roseUsdFeed3.getAddress(),
  ];

  // Deploy as a regular contract for testing (no proxy needed)
  const paymaster = await TestCrossChainPaymasterFactory.deploy();
  await paymaster.waitForDeployment();

  // Call initialize directly
  await paymaster.initialize(
    owner.address,
    mockShoyuBashi,
    distributionLimits,
    STALENESS_THRESHOLD,
    roseUsdFeeds
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
    roseUsdFeed1,
    roseUsdFeed2,
    roseUsdFeed3,
    tokenUsdFeed,
    mockToken,
    owner,
    user1,
    user2,
    vault1,
  };
}

/**
 * Simpler fixture with single ROSE/USD feed for basic tests
 */
export async function deploySimpleTestFixture() {
  const [owner, user1] = await ethers.getSigners();

  const mockShoyuBashi = user1.address;

  // Deploy single ROSE/USD price feed
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

  // Deploy TestCrossChainPaymaster
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

  const roseUsdFeeds = [await roseUsdFeed.getAddress()];

  // Deploy as a regular contract for testing (no proxy needed)
  const paymaster = await TestCrossChainPaymasterFactory.deploy();
  await paymaster.waitForDeployment();

  // Call initialize directly
  await paymaster.initialize(
    owner.address,
    mockShoyuBashi,
    distributionLimits,
    STALENESS_THRESHOLD,
    roseUsdFeeds
  );

  // Set up token price feed
  const tokenAddress = await mockToken.getAddress();
  const tokenUsdFeedAddress = await tokenUsdFeed.getAddress();
  await paymaster.setPriceFeed(tokenAddress, tokenUsdFeedAddress);
  await paymaster.setTokenDecimals(tokenAddress, 6);

  return {
    paymaster,
    roseUsdFeed,
    tokenUsdFeed,
    mockToken,
    owner,
    user1,
  };
}
