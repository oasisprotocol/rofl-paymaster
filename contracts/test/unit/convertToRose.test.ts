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
  calculateMedian,
  calculateMean,
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

  describe("Two ROSE/USD Feeds (Mean)", function () {
    let paymaster: any;
    let mockToken: any;
    let tokenUsdFeed: any;
    let roseUsdFeed1: any;
    let roseUsdFeed2: any;
    let roseUsdFeed3: any;

    beforeEach(async function () {
      ({ paymaster, mockToken, tokenUsdFeed, roseUsdFeed1, roseUsdFeed2, roseUsdFeed3 } =
        await loadFixture(deployTestCrossChainPaymasterFixture));
    });

    it("should use mean of two feeds", async function () {
      const adjustedAmount = parseUnits("100", 6); // 100 USDC
      const tokenPrice = parseUnits("1", 8); // $1.00
      const rose1Price = parseUnits("5", 8); // $5.00
      const rose2Price = parseUnits("7", 8); // $7.00

      await tokenUsdFeed.updateAnswer(tokenPrice);
      await roseUsdFeed1.updateAnswer(rose1Price);
      await roseUsdFeed2.updateAnswer(rose2Price);

      // Remove the third feed to have exactly 2
      await paymaster.removeRoseUsdFeed(await roseUsdFeed3.getAddress());

      const result = await paymaster.exposed_convertToRose(
        await mockToken.getAddress(),
        adjustedAmount
      );

      // Mean of $5 and $7 = $6
      const meanPrice = calculateMean(
        normalizePrice(rose1Price, DECIMALS_8),
        normalizePrice(rose2Price, DECIMALS_8)
      );

      const expected = calculateExpectedRoseAmount(
        adjustedAmount,
        tokenPrice,
        DECIMALS_8,
        meanPrice,
        6
      );

      expect(result).to.equal(expected);
    });

    it("should skip stale feed and use single valid feed", async function () {
      const adjustedAmount = parseUnits("100", 6);
      const tokenPrice = parseUnits("1", 8);
      const validPrice = parseUnits("5", 8);

      await tokenUsdFeed.updateAnswer(tokenPrice);
      await roseUsdFeed1.updateAnswer(validPrice);

      // Make feed2 stale
      const oldTimestamp = (await time.latest()) - STALENESS_THRESHOLD - 1000;
      await roseUsdFeed2.setLatestTimestamp(oldTimestamp);

      // Remove feed3
      await paymaster.removeRoseUsdFeed(await roseUsdFeed3.getAddress());

      const result = await paymaster.exposed_convertToRose(
        await mockToken.getAddress(),
        adjustedAmount
      );

      // Should use only the valid feed
      const expected = calculateExpectedRoseAmount(
        adjustedAmount,
        tokenPrice,
        DECIMALS_8,
        normalizePrice(validPrice, DECIMALS_8),
        6
      );

      expect(result).to.equal(expected);
    });
  });

  describe("Three+ ROSE/USD Feeds (Median)", function () {
    let paymaster: any;
    let mockToken: any;
    let tokenUsdFeed: any;
    let roseUsdFeed1: any;
    let roseUsdFeed2: any;
    let roseUsdFeed3: any;

    beforeEach(async function () {
      ({ paymaster, mockToken, tokenUsdFeed, roseUsdFeed1, roseUsdFeed2, roseUsdFeed3 } =
        await loadFixture(deployTestCrossChainPaymasterFixture));
    });

    it("should use median of three feeds", async function () {
      const adjustedAmount = parseUnits("100", 6);
      const tokenPrice = parseUnits("1", 8);

      const rose1Price = parseUnits("4", 8); // $4.00
      const rose2Price = parseUnits("5", 8); // $5.00
      const rose3Price = parseUnits("6", 8); // $6.00

      await tokenUsdFeed.updateAnswer(tokenPrice);
      await roseUsdFeed1.updateAnswer(rose1Price);
      await roseUsdFeed2.updateAnswer(rose2Price);
      await roseUsdFeed3.updateAnswer(rose3Price);

      const result = await paymaster.exposed_convertToRose(
        await mockToken.getAddress(),
        adjustedAmount
      );

      // Median of [$4, $5, $6] = $5
      const medianPrice = calculateMedian([
        normalizePrice(rose1Price, DECIMALS_8),
        normalizePrice(rose2Price, DECIMALS_8),
        normalizePrice(rose3Price, DECIMALS_8),
      ]);

      const expected = calculateExpectedRoseAmount(
        adjustedAmount,
        tokenPrice,
        DECIMALS_8,
        medianPrice,
        6
      );

      expect(result).to.equal(expected);
    });

    it("should handle outliers with median", async function () {
      const adjustedAmount = parseUnits("100", 6);
      const tokenPrice = parseUnits("1", 8);

      const rose1Price = parseUnits("5", 8); // $5.00
      const rose2Price = parseUnits("5.5", 8); // $5.50
      const rose3Price = parseUnits("100", 8); // $100.00 (outlier)

      await tokenUsdFeed.updateAnswer(tokenPrice);
      await roseUsdFeed1.updateAnswer(rose1Price);
      await roseUsdFeed2.updateAnswer(rose2Price);
      await roseUsdFeed3.updateAnswer(rose3Price);

      const result = await paymaster.exposed_convertToRose(
        await mockToken.getAddress(),
        adjustedAmount
      );

      // Median should be resistant to the outlier
      const medianPrice = calculateMedian([
        normalizePrice(rose1Price, DECIMALS_8),
        normalizePrice(rose2Price, DECIMALS_8),
        normalizePrice(rose3Price, DECIMALS_8),
      ]);

      const expected = calculateExpectedRoseAmount(
        adjustedAmount,
        tokenPrice,
        DECIMALS_8,
        medianPrice,
        6
      );

      expect(result).to.equal(expected);
      // Should use $5.50 rather than being affected by $100
    });

    it("should skip invalid feeds and use remaining for median", async function () {
      const adjustedAmount = parseUnits("100", 6);
      const tokenPrice = parseUnits("1", 8);

      const rose1Price = parseUnits("5", 8); // Valid
      const rose2Price = parseUnits("6", 8); // Valid
      const rose3Price = -1n; // Invalid (negative)

      await tokenUsdFeed.updateAnswer(tokenPrice);
      await roseUsdFeed1.updateAnswer(rose1Price);
      await roseUsdFeed2.updateAnswer(rose2Price);
      await roseUsdFeed3.updateAnswer(rose3Price);

      const result = await paymaster.exposed_convertToRose(
        await mockToken.getAddress(),
        adjustedAmount
      );

      // Should use mean of the two valid feeds (since only 2 valid)
      const meanPrice = calculateMean(
        normalizePrice(rose1Price, DECIMALS_8),
        normalizePrice(rose2Price, DECIMALS_8)
      );

      const expected = calculateExpectedRoseAmount(
        adjustedAmount,
        tokenPrice,
        DECIMALS_8,
        meanPrice,
        6
      );

      expect(result).to.equal(expected);
    });
  });

  describe("Different Decimal Configurations", function () {
    let paymaster: any;
    let mockToken: any;
    let tokenUsdFeed: any;

    beforeEach(async function () {
      ({ paymaster, mockToken, tokenUsdFeed } = await loadFixture(
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

      // Add the new feed (need to get existing feeds and add to them)
      await paymaster.addRoseUsdFeed(await roseUsdFeed18.getAddress());

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
      await paymaster.addRoseUsdFeed(await roseUsdFeed6.getAddress());

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
    describe("with single feed", function () {
      let paymaster: any;
      let mockToken: any;
      let tokenUsdFeed: any;

      beforeEach(async function () {
        ({ paymaster, mockToken, tokenUsdFeed } = await loadFixture(deploySimpleTestFixture));
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
    });

    describe("with multiple feeds", function () {
      let paymaster: any;
      let mockToken: any;
      let tokenUsdFeed: any;
      let roseUsdFeed1: any;
      let roseUsdFeed2: any;
      let roseUsdFeed3: any;

      beforeEach(async function () {
        ({ paymaster, mockToken, tokenUsdFeed, roseUsdFeed1, roseUsdFeed2, roseUsdFeed3 } =
          await loadFixture(deployTestCrossChainPaymasterFixture));
      });

      it("should skip stale ROSE feeds and use valid ones", async function () {
        const adjustedAmount = parseUnits("100", 6);
        const tokenPrice = parseUnits("1", 8);
        const validPrice = parseUnits("5", 8);

        await tokenUsdFeed.updateAnswer(tokenPrice);
        await roseUsdFeed1.updateAnswer(validPrice);
        await roseUsdFeed2.updateAnswer(validPrice);

        // Make feed3 stale
        const oldTimestamp = (await time.latest()) - STALENESS_THRESHOLD - 1000;
        await roseUsdFeed3.setLatestTimestamp(oldTimestamp);

        const result = await paymaster.exposed_convertToRose(
          await mockToken.getAddress(),
          adjustedAmount
        );

        // Should use the two valid feeds
        expect(result).to.be.gt(0n);
      });

      it("should revert when all ROSE feeds are stale", async function () {
        const adjustedAmount = parseUnits("100", 6);
        const tokenPrice = parseUnits("1", 8);

        await tokenUsdFeed.updateAnswer(tokenPrice);

        // Make all ROSE feeds stale
        const oldTimestamp = (await time.latest()) - STALENESS_THRESHOLD - 1000;
        await roseUsdFeed1.setLatestTimestamp(oldTimestamp);
        await roseUsdFeed2.setLatestTimestamp(oldTimestamp);
        await roseUsdFeed3.setLatestTimestamp(oldTimestamp);

        await expect(
          paymaster.exposed_convertToRose(await mockToken.getAddress(), adjustedAmount)
        ).to.be.revertedWithCustomError(paymaster, "NoValidRoseUsdFeeds");
      });
    });
  });

  describe("Invalid Price Handling", function () {
    describe("token price validation", function () {
      let paymaster: any;
      let mockToken: any;
      let tokenUsdFeed: any;

      beforeEach(async function () {
        ({ paymaster, mockToken, tokenUsdFeed } = await loadFixture(deploySimpleTestFixture));
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
    });

    describe("ROSE feed price validation", function () {
      let paymaster: any;
      let mockToken: any;
      let tokenUsdFeed: any;
      let roseUsdFeed1: any;
      let roseUsdFeed2: any;
      let roseUsdFeed3: any;

      beforeEach(async function () {
        ({ paymaster, mockToken, tokenUsdFeed, roseUsdFeed1, roseUsdFeed2, roseUsdFeed3 } =
          await loadFixture(deployTestCrossChainPaymasterFixture));
      });

      it("should skip ROSE feeds with zero price", async function () {
        const adjustedAmount = parseUnits("100", 6);
        const tokenPrice = parseUnits("1", 8);
        const validPrice = parseUnits("5", 8);

        await tokenUsdFeed.updateAnswer(tokenPrice);
        await roseUsdFeed1.updateAnswer(validPrice);
        await roseUsdFeed2.updateAnswer(0); // Invalid
        await roseUsdFeed3.updateAnswer(validPrice);

        const result = await paymaster.exposed_convertToRose(
          await mockToken.getAddress(),
          adjustedAmount
        );

        // Should use the two valid feeds
        expect(result).to.be.gt(0n);
      });

      it("should skip ROSE feeds with negative price", async function () {
        const adjustedAmount = parseUnits("100", 6);
        const tokenPrice = parseUnits("1", 8);
        const validPrice = parseUnits("5", 8);

        await tokenUsdFeed.updateAnswer(tokenPrice);
        await roseUsdFeed1.updateAnswer(validPrice);
        await roseUsdFeed2.updateAnswer(-100); // Invalid
        await roseUsdFeed3.updateAnswer(validPrice);

        const result = await paymaster.exposed_convertToRose(
          await mockToken.getAddress(),
          adjustedAmount
        );

        // Should use the two valid feeds
        expect(result).to.be.gt(0n);
      });
    });
  });

  describe("Failed Feed Calls", function () {
    let paymaster: any;
    let mockToken: any;
    let tokenUsdFeed: any;
    let roseUsdFeed1: any;
    let roseUsdFeed2: any;
    let roseUsdFeed3: any;

    beforeEach(async function () {
      ({ paymaster, mockToken, tokenUsdFeed, roseUsdFeed1, roseUsdFeed2, roseUsdFeed3 } =
        await loadFixture(deployTestCrossChainPaymasterFixture));
    });

    it("should skip feeds that revert", async function () {
      const adjustedAmount = parseUnits("100", 6);
      const tokenPrice = parseUnits("1", 8);
      const validPrice = parseUnits("5", 8);

      await tokenUsdFeed.updateAnswer(tokenPrice);
      await roseUsdFeed1.updateAnswer(validPrice);
      await roseUsdFeed2.setShouldRevert(true); // This feed will revert
      await roseUsdFeed3.updateAnswer(validPrice);

      const result = await paymaster.exposed_convertToRose(
        await mockToken.getAddress(),
        adjustedAmount
      );

      // Should use the two valid feeds
      expect(result).to.be.gt(0n);
    });

    it("should revert when all ROSE feeds fail", async function () {
      const adjustedAmount = parseUnits("100", 6);
      const tokenPrice = parseUnits("1", 8);

      await tokenUsdFeed.updateAnswer(tokenPrice);
      await roseUsdFeed1.setShouldRevert(true);
      await roseUsdFeed2.setShouldRevert(true);
      await roseUsdFeed3.setShouldRevert(true);

      await expect(
        paymaster.exposed_convertToRose(await mockToken.getAddress(), adjustedAmount)
      ).to.be.revertedWithCustomError(paymaster, "NoValidRoseUsdFeeds");
    });
  });

  describe("Stale Round Detection", function () {
    describe("token feed stale round", function () {
      let paymaster: any;
      let mockToken: any;
      let tokenUsdFeed: any;

      beforeEach(async function () {
        ({ paymaster, mockToken, tokenUsdFeed } = await loadFixture(deploySimpleTestFixture));
      });

      it("should revert when token feed has stale round", async function () {
        const adjustedAmount = parseUnits("100", 6);

        await tokenUsdFeed.setShouldReturnStaleRound(true);

        await expect(
          paymaster.exposed_convertToRose(await mockToken.getAddress(), adjustedAmount)
        ).to.be.revertedWithCustomError(paymaster, "StalePrice");
      });
    });

    describe("ROSE feed stale rounds", function () {
      let paymaster: any;
      let mockToken: any;
      let tokenUsdFeed: any;
      let roseUsdFeed1: any;
      let roseUsdFeed2: any;
      let roseUsdFeed3: any;

      beforeEach(async function () {
        ({ paymaster, mockToken, tokenUsdFeed, roseUsdFeed1, roseUsdFeed2, roseUsdFeed3 } =
          await loadFixture(deployTestCrossChainPaymasterFixture));
      });

      it("should skip ROSE feeds with stale rounds", async function () {
        const adjustedAmount = parseUnits("100", 6);
        const tokenPrice = parseUnits("1", 8);
        const validPrice = parseUnits("5", 8);

        await tokenUsdFeed.updateAnswer(tokenPrice);
        await roseUsdFeed1.updateAnswer(validPrice);
        await roseUsdFeed2.setShouldReturnStaleRound(true); // Stale round
        await roseUsdFeed3.updateAnswer(validPrice);

        const result = await paymaster.exposed_convertToRose(
          await mockToken.getAddress(),
          adjustedAmount
        );

        // Should use the two valid feeds
        expect(result).to.be.gt(0n);
      });
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
