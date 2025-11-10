import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deploySimpleTestFixture } from "../fixtures/CrossChainPaymaster.fixture";
import { calculateMedian } from "../helpers/priceHelpers";

describe("CrossChainPaymaster - _calculateMedian", function () {
  let paymaster: any;

  beforeEach(async function () {
    const fixture = await loadFixture(deploySimpleTestFixture);
    paymaster = fixture.paymaster;
  });

  describe("Single Value", function () {
    it("should return the single value", async function () {
      const prices = [100n];
      const result = await paymaster.exposed_calculateMedian(prices, 1);

      expect(result).to.equal(100n);
    });

    it("should handle large single value", async function () {
      const largeValue = 1_000_000_000_000_000_000n; // 1 ETH in wei
      const prices = [largeValue];
      const result = await paymaster.exposed_calculateMedian(prices, 1);

      expect(result).to.equal(largeValue);
    });
  });

  describe("Two Values (Mean)", function () {
    it("should return the mean of two equal values", async function () {
      const prices = [100n, 100n];
      const result = await paymaster.exposed_calculateMedian(prices, 2);

      expect(result).to.equal(100n);
    });

    it("should return the mean of two different values", async function () {
      const prices = [100n, 200n];
      const result = await paymaster.exposed_calculateMedian(prices, 2);

      expect(result).to.equal(150n); // (100 + 200) / 2 = 150
    });

    it("should handle odd sum (rounds down)", async function () {
      const prices = [100n, 201n];
      const result = await paymaster.exposed_calculateMedian(prices, 2);

      expect(result).to.equal(150n); // (100 + 201) / 2 = 150 (Solidity rounds down)
    });

    it("should return mean regardless of order", async function () {
      const prices1 = [100n, 200n];
      const prices2 = [200n, 100n];

      const result1 = await paymaster.exposed_calculateMedian(prices1, 2);
      const result2 = await paymaster.exposed_calculateMedian(prices2, 2);

      expect(result1).to.equal(result2);
      expect(result1).to.equal(150n);
    });
  });

  describe("Three Values (Odd - Median)", function () {
    it("should return the middle value when already sorted", async function () {
      const prices = [100n, 200n, 300n];
      const result = await paymaster.exposed_calculateMedian(prices, 3);

      expect(result).to.equal(200n);
    });

    it("should return the middle value when unsorted", async function () {
      const prices = [300n, 100n, 200n];
      const result = await paymaster.exposed_calculateMedian(prices, 3);

      expect(result).to.equal(200n);
    });

    it("should return the middle value with duplicates", async function () {
      const prices = [100n, 100n, 200n];
      const result = await paymaster.exposed_calculateMedian(prices, 3);

      expect(result).to.equal(100n);
    });

    it("should handle all same values", async function () {
      const prices = [150n, 150n, 150n];
      const result = await paymaster.exposed_calculateMedian(prices, 3);

      expect(result).to.equal(150n);
    });
  });

  describe("Four Values (Even - Mean of Middle Two)", function () {
    it("should return mean of middle two values", async function () {
      const prices = [100n, 200n, 300n, 400n];
      const result = await paymaster.exposed_calculateMedian(prices, 4);

      expect(result).to.equal(250n); // (200 + 300) / 2 = 250
    });

    it("should handle unsorted values", async function () {
      const prices = [400n, 100n, 300n, 200n];
      const result = await paymaster.exposed_calculateMedian(prices, 4);

      expect(result).to.equal(250n); // Sorted: [100, 200, 300, 400], median = (200 + 300) / 2
    });

    it("should handle duplicates in middle", async function () {
      const prices = [100n, 200n, 200n, 400n];
      const result = await paymaster.exposed_calculateMedian(prices, 4);

      expect(result).to.equal(200n); // (200 + 200) / 2 = 200
    });
  });

  describe("Five Values (Odd - Median)", function () {
    it("should return the middle value", async function () {
      const prices = [100n, 200n, 300n, 400n, 500n];
      const result = await paymaster.exposed_calculateMedian(prices, 5);

      expect(result).to.equal(300n);
    });

    it("should handle unsorted values", async function () {
      const prices = [500n, 100n, 300n, 400n, 200n];
      const result = await paymaster.exposed_calculateMedian(prices, 5);

      expect(result).to.equal(300n);
    });

    it("should handle extreme outliers", async function () {
      const prices = [1n, 100n, 110n, 120n, 1000000n];
      const result = await paymaster.exposed_calculateMedian(prices, 5);

      expect(result).to.equal(110n); // Median is resistant to outliers
    });
  });

  describe("Six Values (Even - Mean of Middle Two)", function () {
    it("should return mean of middle two values", async function () {
      const prices = [100n, 200n, 300n, 400n, 500n, 600n];
      const result = await paymaster.exposed_calculateMedian(prices, 6);

      expect(result).to.equal(350n); // (300 + 400) / 2 = 350
    });

    it("should handle unsorted values", async function () {
      const prices = [600n, 100n, 400n, 200n, 500n, 300n];
      const result = await paymaster.exposed_calculateMedian(prices, 6);

      expect(result).to.equal(350n);
    });
  });

  describe("Seven Values (Odd - Median)", function () {
    it("should return the middle value", async function () {
      const prices = [100n, 200n, 300n, 400n, 500n, 600n, 700n];
      const result = await paymaster.exposed_calculateMedian(prices, 7);

      expect(result).to.equal(400n);
    });

    it("should handle extreme distribution", async function () {
      const prices = [1n, 2n, 3n, 1000n, 1000000n, 1000000000n, 1000000000000n];
      const result = await paymaster.exposed_calculateMedian(prices, 7);

      expect(result).to.equal(1000n); // Median of sorted: [1, 2, 3, 1000, 1000000, ...]
    });
  });

  describe("Partial Array (Count < Array Length)", function () {
    it("should only consider first 'count' elements", async function () {
      // Array has 5 elements, but only first 3 are valid
      const prices = [100n, 200n, 300n, 999999n, 999999n];
      const result = await paymaster.exposed_calculateMedian(prices, 3);

      expect(result).to.equal(200n); // Should ignore the 999999 values
    });

    it("should handle count=1 in larger array", async function () {
      const prices = [500n, 100n, 200n, 300n, 400n];
      const result = await paymaster.exposed_calculateMedian(prices, 1);

      expect(result).to.equal(500n); // Only first element considered
    });

    it("should handle count=2 in larger array", async function () {
      const prices = [100n, 300n, 200n, 400n, 500n];
      const result = await paymaster.exposed_calculateMedian(prices, 2);

      expect(result).to.equal(200n); // (100 + 300) / 2 = 200
    });
  });

  describe("Edge Cases", function () {
    it("should handle very large values", async function () {
      const maxUint128 = 2n ** 128n - 1n;
      const prices = [maxUint128, maxUint128, maxUint128];
      const result = await paymaster.exposed_calculateMedian(prices, 3);

      expect(result).to.equal(maxUint128);
    });

    it("should handle values with large spread", async function () {
      const prices = [1n, 1000000000000000000n, 2000000000000000000n];
      const result = await paymaster.exposed_calculateMedian(prices, 3);

      expect(result).to.equal(1000000000000000000n);
    });
  });

  describe("Comparison with Helper", function () {
    it("should match TypeScript helper calculation (3 values)", async function () {
      const prices = [150n, 120n, 180n];
      const contractResult = await paymaster.exposed_calculateMedian(prices, 3);
      const helperResult = calculateMedian(prices);

      expect(contractResult).to.equal(helperResult);
    });

    it("should match TypeScript helper calculation (5 values)", async function () {
      const prices = [100n, 200n, 150n, 250n, 175n];
      const contractResult = await paymaster.exposed_calculateMedian(prices, 5);
      const helperResult = calculateMedian(prices);

      expect(contractResult).to.equal(helperResult);
    });

    it("should match TypeScript helper calculation (even count)", async function () {
      const prices = [100n, 200n, 300n, 400n];
      const contractResult = await paymaster.exposed_calculateMedian(prices, 4);
      const helperResult = calculateMedian(prices);

      expect(contractResult).to.equal(helperResult);
    });
  });
});
