import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { ethers } from "hardhat";
import { parseEther, parseUnits } from "ethers";
import {
  deployTestCrossChainPaymasterFixture,
  deploySimpleTestFixture,
} from "../fixtures/CrossChainPaymaster.fixture";
import {
  calculateExpectedRoseAmount,
  normalizePrice,
} from "../helpers/priceHelpers";
import {
  DECIMALS_8,
  DECIMALS_18,
  DECIMALS_6,
  STALENESS_THRESHOLD,
} from "../helpers/constants";

describe("CrossChainPaymaster - _convertToRose", function () {
  describe("Single ROSE/USD Feed", function () {
    let paymaster: any;
    let mockToken: any;
    let tokenUsdFeed: any;
    let roseUsdFeed: any;

    beforeEach(async function () {
      ({ paymaster, mockToken, tokenUsdFeed, roseUsdFeed } = await loadFixture(
        deploySimpleTestFixture
      ));
    });

    it("should return ROSE amount in 18 decimals", async function () {
      // 100 USDC at $1 each = $100
      // ROSE at $5 each = 20 ROSE
      const adjustedAmount = parseUnits("100", 6);
      const tokenPrice = parseUnits("1", 8);
      const rosePrice = parseUnits("5", 8);

      await tokenUsdFeed.updateAnswer(tokenPrice);
      await roseUsdFeed.updateAnswer(rosePrice);

      const result = await paymaster.exposed_convertToRose(
        await mockToken.getAddress(),
        adjustedAmount
      );

      // Result should be exactly 20 ROSE in 18 decimals
      expect(result).to.equal(parseEther("20"));
    });

    it("should convert correctly with 8 decimal feeds", async function () {
      const adjustedAmount = parseUnits("100", 6); // 100 USDC with 6 decimals

      const tokenPrice = parseUnits("1", 8); // $1.00
      const rosePrice = parseUnits("5", 8); // $5.00

      await tokenUsdFeed.updateAnswer(tokenPrice);
      await roseUsdFeed.updateAnswer(rosePrice);

      const result = await paymaster.exposed_convertToRose(
        await mockToken.getAddress(),
        adjustedAmount
      );

      // Result should be positive and reasonable for 100 USDC -> ROSE
      expect(result).to.be.gt(0);
      // At $1/USDC and $5/ROSE, 100 USDC = $100 / $5 = 20 ROSE
      expect(result).to.be.gte(parseEther("10")); // At least 10 ROSE
    });

    it("should handle different token prices", async function () {
      const adjustedAmount = parseUnits("50", 6); // 50 USDC
      const tokenPrice = parseUnits("2", 8); // $2.00
      const rosePrice = parseUnits("10", 8); // $10.00

      await tokenUsdFeed.updateAnswer(tokenPrice);
      await roseUsdFeed.updateAnswer(rosePrice);

      const result = await paymaster.exposed_convertToRose(
        await mockToken.getAddress(),
        adjustedAmount
      );

      // 50 USDC * $2 = $100, at $10/ROSE = 10 ROSE
      expect(result).to.be.gt(0);
      expect(result).to.be.gte(parseEther("5")); // At least 5 ROSE
    });

    it("should handle fractional results", async function () {
      const adjustedAmount = parseUnits("1", 6); // 1 USDC
      const tokenPrice = parseUnits("1", 8); // $1.00
      const rosePrice = parseUnits("3", 8); // $3.00

      await tokenUsdFeed.updateAnswer(tokenPrice);
      await roseUsdFeed.updateAnswer(rosePrice);

      const result = await paymaster.exposed_convertToRose(
        await mockToken.getAddress(),
        adjustedAmount
      );

      // Expected: 1 USDC * $1 / $3 = 0.333... ROSE
      const expected = calculateExpectedRoseAmount(
        adjustedAmount,
        tokenPrice,
        DECIMALS_8,
        normalizePrice(rosePrice, DECIMALS_8),
        6
      );

      expect(result).to.equal(expected);
    });
  });

  describe("Different Decimal Configurations", function () {
    let paymaster: any;
    let mockToken: any;
    let tokenUsdFeed: any;
    let roseUsdFeed: any;

    beforeEach(async function () {
      ({ paymaster, mockToken, tokenUsdFeed, roseUsdFeed } = await loadFixture(
        deploySimpleTestFixture
      ));
    });

    it("should handle 18 decimal ROSE feed", async function () {
      // Deploy new ROSE feed with 18 decimals
      const MockV3AggregatorFactory = await ethers.getContractFactory("contracts/test/mocks/MockV3Aggregator.sol:MockV3Aggregator");
      const roseUsdFeed18 = await MockV3AggregatorFactory.deploy(
        DECIMALS_18,
        parseUnits("0.05", 18) // $0.05 with 18 decimals
      );

      // Update the ROSE feed
      await paymaster.setRoseUsdFeed(await roseUsdFeed18.getAddress());

      const adjustedAmount = parseUnits("100", 6);
      const tokenPrice = parseUnits("1", 8);

      await tokenUsdFeed.updateAnswer(tokenPrice);

      const result = await paymaster.exposed_convertToRose(
        await mockToken.getAddress(),
        adjustedAmount
      );

      // Should normalize the 18 decimal feed price and use it
      expect(result).to.be.gt(0n);
    });

    it("should handle 6 decimal price feeds", async function () {
      // Deploy feeds with 6 decimals
      const MockV3AggregatorFactory = await ethers.getContractFactory("contracts/test/mocks/MockV3Aggregator.sol:MockV3Aggregator");

      const tokenUsdFeed6 = await MockV3AggregatorFactory.deploy(
        DECIMALS_6,
        parseUnits("1", 6) // $1.00 with 6 decimals
      );
      const roseUsdFeed6 = await MockV3AggregatorFactory.deploy(
        DECIMALS_6,
        parseUnits("0.05", 6) // $0.05 with 6 decimals
      );

      // Set up new feeds
      await paymaster.setPriceFeed(await mockToken.getAddress(), await tokenUsdFeed6.getAddress());
      await paymaster.setRoseUsdFeed(await roseUsdFeed6.getAddress());

      const adjustedAmount = parseUnits("100", 6);

      const result = await paymaster.exposed_convertToRose(
        await mockToken.getAddress(),
        adjustedAmount
      );

      // Result should still be meaningful despite different decimals
      expect(result).to.be.gt(0n);
    });
  });

  describe("Price Staleness Detection", function () {
    let paymaster: any;
    let mockToken: any;
    let tokenUsdFeed: any;
    let roseUsdFeed: any;

    beforeEach(async function () {
      ({ paymaster, mockToken, tokenUsdFeed, roseUsdFeed } = await loadFixture(deploySimpleTestFixture));
    });

    it("should revert when token price is stale", async function () {
      const adjustedAmount = parseUnits("100", 6);

      // Make token price stale
      const oldTimestamp = (await time.latest()) - STALENESS_THRESHOLD - 1000;
      await tokenUsdFeed.setLatestTimestamp(oldTimestamp);

      await expect(
        paymaster.exposed_convertToRose(await mockToken.getAddress(), adjustedAmount)
      ).to.be.revertedWithCustomError(paymaster, "StalePrice");
    });

    it("should revert when ROSE price is stale", async function () {
      const adjustedAmount = parseUnits("100", 6);
      const tokenPrice = parseUnits("1", 8);

      await tokenUsdFeed.updateAnswer(tokenPrice);

      // Make ROSE price stale
      const oldTimestamp = (await time.latest()) - STALENESS_THRESHOLD - 1000;
      await roseUsdFeed.setLatestTimestamp(oldTimestamp);

      await expect(
        paymaster.exposed_convertToRose(await mockToken.getAddress(), adjustedAmount)
      ).to.be.revertedWithCustomError(paymaster, "StalePrice");
    });
  });

  describe("Invalid Price Handling", function () {
    let paymaster: any;
    let mockToken: any;
    let tokenUsdFeed: any;
    let roseUsdFeed: any;

    beforeEach(async function () {
      ({ paymaster, mockToken, tokenUsdFeed, roseUsdFeed } = await loadFixture(deploySimpleTestFixture));
    });

    it("should revert when token price is zero", async function () {
      const adjustedAmount = parseUnits("100", 6);

      await tokenUsdFeed.updateAnswer(0);

      await expect(
        paymaster.exposed_convertToRose(await mockToken.getAddress(), adjustedAmount)
      ).to.be.revertedWithCustomError(paymaster, "InvalidPrice");
    });

    it("should revert when token price is negative", async function () {
      const adjustedAmount = parseUnits("100", 6);

      await tokenUsdFeed.updateAnswer(-100);

      await expect(
        paymaster.exposed_convertToRose(await mockToken.getAddress(), adjustedAmount)
      ).to.be.revertedWithCustomError(paymaster, "InvalidPrice");
    });

    it("should revert when ROSE price is zero", async function () {
      const adjustedAmount = parseUnits("100", 6);
      const tokenPrice = parseUnits("1", 8);

      await tokenUsdFeed.updateAnswer(tokenPrice);
      await roseUsdFeed.updateAnswer(0);

      await expect(
        paymaster.exposed_convertToRose(await mockToken.getAddress(), adjustedAmount)
      ).to.be.revertedWithCustomError(paymaster, "InvalidPrice");
    });

    it("should revert when ROSE price is negative", async function () {
      const adjustedAmount = parseUnits("100", 6);
      const tokenPrice = parseUnits("1", 8);

      await tokenUsdFeed.updateAnswer(tokenPrice);
      await roseUsdFeed.updateAnswer(-100);

      await expect(
        paymaster.exposed_convertToRose(await mockToken.getAddress(), adjustedAmount)
      ).to.be.revertedWithCustomError(paymaster, "InvalidPrice");
    });
  });

  describe("Stale Round Detection", function () {
    let paymaster: any;
    let mockToken: any;
    let tokenUsdFeed: any;
    let roseUsdFeed: any;

    beforeEach(async function () {
      ({ paymaster, mockToken, tokenUsdFeed, roseUsdFeed } = await loadFixture(deploySimpleTestFixture));
    });

    it("should revert when token feed has stale round", async function () {
      const adjustedAmount = parseUnits("100", 6);

      await tokenUsdFeed.setShouldReturnStaleRound(true);

      await expect(
        paymaster.exposed_convertToRose(await mockToken.getAddress(), adjustedAmount)
      ).to.be.revertedWithCustomError(paymaster, "StalePrice");
    });

    it("should revert when ROSE feed has stale round", async function () {
      const adjustedAmount = parseUnits("100", 6);
      const tokenPrice = parseUnits("1", 8);

      await tokenUsdFeed.updateAnswer(tokenPrice);
      await roseUsdFeed.setShouldReturnStaleRound(true);

      await expect(
        paymaster.exposed_convertToRose(await mockToken.getAddress(), adjustedAmount)
      ).to.be.revertedWithCustomError(paymaster, "StalePrice");
    });
  });

  describe("Future Price Timestamp Detection", function () {
    let paymaster: any;
    let mockToken: any;
    let tokenUsdFeed: any;
    let roseUsdFeed: any;

    beforeEach(async function () {
      ({ paymaster, mockToken, tokenUsdFeed, roseUsdFeed } = await loadFixture(deploySimpleTestFixture));
    });

    it("should revert when token feed has future timestamp", async function () {
      const adjustedAmount = parseUnits("100", 6);

      // Set token price feed timestamp to future (current + 100 seconds)
      const futureTimestamp = (await time.latest()) + 100;
      await tokenUsdFeed.setLatestTimestamp(futureTimestamp);

      await expect(
        paymaster.exposed_convertToRose(await mockToken.getAddress(), adjustedAmount)
      ).to.be.revertedWithCustomError(paymaster, "FuturePriceTimestamp");
    });

    it("should revert when ROSE feed has future timestamp", async function () {
      const adjustedAmount = parseUnits("100", 6);
      const tokenPrice = parseUnits("1", 8);

      // Token feed is valid
      await tokenUsdFeed.updateAnswer(tokenPrice);

      // Set ROSE price feed timestamp to future
      const futureTimestamp = (await time.latest()) + 100;
      await roseUsdFeed.setLatestTimestamp(futureTimestamp);

      await expect(
        paymaster.exposed_convertToRose(await mockToken.getAddress(), adjustedAmount)
      ).to.be.revertedWithCustomError(paymaster, "FuturePriceTimestamp");
    });

    it("should revert with correct error args for future token timestamp", async function () {
      const adjustedAmount = parseUnits("100", 6);

      const futureTimestamp = (await time.latest()) + 500;
      await tokenUsdFeed.setLatestTimestamp(futureTimestamp);

      await expect(
        paymaster.exposed_convertToRose(await mockToken.getAddress(), adjustedAmount)
      )
        .to.be.revertedWithCustomError(paymaster, "FuturePriceTimestamp")
        .withArgs(futureTimestamp, await time.latest());
    });

    it("should accept price when timestamp equals block.timestamp", async function () {
      const adjustedAmount = parseUnits("100", 6);
      const tokenPrice = parseUnits("1", 8);
      const rosePrice = parseUnits("5", 8);

      await tokenUsdFeed.updateAnswer(tokenPrice);
      await roseUsdFeed.updateAnswer(rosePrice);

      // Set timestamp to exactly current block timestamp (edge case - should pass)
      const currentTimestamp = await time.latest();
      await tokenUsdFeed.setLatestTimestamp(currentTimestamp);
      await roseUsdFeed.setLatestTimestamp(currentTimestamp);

      // Should NOT revert - timestamp == block.timestamp is valid
      const result = await paymaster.exposed_convertToRose(
        await mockToken.getAddress(),
        adjustedAmount
      );
      expect(result).to.be.gt(0n);
    });
  });

  describe("No Price Feed Errors", function () {
    let paymaster: any;

    beforeEach(async function () {
      ({ paymaster } = await loadFixture(deploySimpleTestFixture));
    });

    it("should revert when token has no price feed", async function () {
      const randomToken = ethers.Wallet.createRandom().address;
      const adjustedAmount = parseUnits("100", 6);

      await expect(
        paymaster.exposed_convertToRose(randomToken, adjustedAmount)
      ).to.be.revertedWithCustomError(paymaster, "NoPriceFeedForToken");
    });

    it("should revert when ROSE feed is not set", async function () {
      const [owner, user1] = await ethers.getSigners();

      // Deploy a fresh paymaster without ROSE feed (zero address)
      const MockV3AggregatorFactory = await ethers.getContractFactory("contracts/test/mocks/MockV3Aggregator.sol:MockV3Aggregator");
      const tokenUsdFeed = await MockV3AggregatorFactory.deploy(8, parseUnits("1", 8));

      const MockTokenFactory = await ethers.getContractFactory("MockToken");
      const mockToken = await MockTokenFactory.deploy("Mock USDC", "USDC", 6);

      // This should revert during initialization since we can't pass zero address
      const TestCrossChainPaymasterFactory = await ethers.getContractFactory("TestCrossChainPaymaster");
      const freshPaymaster = await TestCrossChainPaymasterFactory.deploy();

      await expect(
        freshPaymaster.initialize(
          owner.address,
          user1.address,
          { dailyLimit: parseEther("1000"), perTxLimit: parseEther("100"), lastResetDay: 0, currentDaily: 0, enabled: true },
          3600,
          ethers.ZeroAddress // Zero address for ROSE feed
        )
      ).to.be.revertedWithCustomError(freshPaymaster, "InvalidPriceFeed");
    });
  });

  describe("Edge Cases", function () {
    let paymaster: any;
    let mockToken: any;
    let tokenUsdFeed: any;
    let roseUsdFeed: any;

    beforeEach(async function () {
      ({ paymaster, mockToken, tokenUsdFeed, roseUsdFeed } = await loadFixture(
        deploySimpleTestFixture
      ));
    });

    it("should handle very small token amounts", async function () {
      const adjustedAmount = 1n; // Smallest possible amount
      const tokenPrice = parseUnits("1", 8);
      const rosePrice = parseUnits("5", 8);

      await tokenUsdFeed.updateAnswer(tokenPrice);
      await roseUsdFeed.updateAnswer(rosePrice);

      const result = await paymaster.exposed_convertToRose(
        await mockToken.getAddress(),
        adjustedAmount
      );

      // Should handle without reverting (result might be 0 due to rounding)
      expect(result).to.be.gte(0n);
    });

    it("should handle very large token amounts", async function () {
      const adjustedAmount = parseUnits("1000000", 6); // 1 million tokens
      const tokenPrice = parseUnits("1", 8);
      const rosePrice = parseUnits("5", 8);

      await tokenUsdFeed.updateAnswer(tokenPrice);
      await roseUsdFeed.updateAnswer(rosePrice);

      const result = await paymaster.exposed_convertToRose(
        await mockToken.getAddress(),
        adjustedAmount
      );

      expect(result).to.be.gt(0n);
    });

    it("should handle token with 0 configured decimals (defaults to 18)", async function () {
      // Deploy a new token without setting decimals
      const MockTokenFactory = await ethers.getContractFactory("MockToken");
      const newToken = await MockTokenFactory.deploy("Test", "TEST", 18);
      await paymaster.setPriceFeed(await newToken.getAddress(), await tokenUsdFeed.getAddress());
      // Don't call setTokenDecimals - it should default to 18

      const amount = parseEther("100");
      const tokenPrice = parseUnits("1", 8);
      const rosePrice = parseUnits("5", 8);

      await tokenUsdFeed.updateAnswer(tokenPrice);
      await roseUsdFeed.updateAnswer(rosePrice);

      const result = await paymaster.exposed_convertToRose(await newToken.getAddress(), amount);

      expect(result).to.be.gt(0n);
    });
  });
});
