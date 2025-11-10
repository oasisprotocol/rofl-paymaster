import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { ethers } from "hardhat";
import { parseEther, ZeroAddress } from "ethers";
import {
  deployTestCrossChainPaymasterFixture,
  deploySimpleTestFixture,
} from "../fixtures/CrossChainPaymaster.fixture";
import {
  DECIMALS_8,
  STALENESS_THRESHOLD,
  DAILY_LIMIT,
  PER_TX_LIMIT,
} from "../helpers/constants";

describe("CrossChainPaymaster - Integration Tests", function () {
  describe("Initialization", function () {
    it("should initialize with correct parameters", async function () {
      const { paymaster, roseUsdFeed1, roseUsdFeed2, roseUsdFeed3, owner } = await loadFixture(
        deployTestCrossChainPaymasterFixture
      );

      // Check staleness threshold
      expect(await paymaster.stalenessThreshold()).to.equal(STALENESS_THRESHOLD);

      // Check ROSE/USD feeds
      const feeds = await paymaster.getRoseUsdFeeds();
      expect(feeds).to.have.lengthOf(3);
      expect(feeds).to.include(await roseUsdFeed1.getAddress());
      expect(feeds).to.include(await roseUsdFeed2.getAddress());
      expect(feeds).to.include(await roseUsdFeed3.getAddress());

      // Check distribution limits
      const limits = await paymaster.limits();
      expect(limits.dailyLimit).to.equal(DAILY_LIMIT);
      expect(limits.perTxLimit).to.equal(PER_TX_LIMIT);
      expect(limits.enabled).to.be.true;

      // Check owner
      expect(await paymaster.owner()).to.equal(owner.address);
    });

    it("should revert if initialized with no ROSE/USD feeds", async function () {
      const [owner, user1] = await ethers.getSigners();
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

      const paymaster = await TestCrossChainPaymasterFactory.deploy();
      await paymaster.waitForDeployment();

      await expect(
        paymaster.initialize(
          owner.address,
          user1.address,
          distributionLimits,
          STALENESS_THRESHOLD,
          [] // Empty ROSE feeds array
        )
      ).to.be.revertedWithCustomError(paymaster, "NoRoseUsdFeeds");
    });

    it("should revert if initialized with zero address feed", async function () {
      const [owner, user1] = await ethers.getSigners();
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

      const paymaster = await TestCrossChainPaymasterFactory.deploy();
      await paymaster.waitForDeployment();

      await expect(
        paymaster.initialize(
          owner.address,
          user1.address,
          distributionLimits,
          STALENESS_THRESHOLD,
          [ZeroAddress]
        )
      ).to.be.revertedWithCustomError(paymaster, "InvalidPriceFeed");
    });
  });

  describe("Price Feed Management", function () {
    describe("setPriceFeed", function () {
      let paymaster: any;
      let user1: any;

      beforeEach(async function () {
        ({ paymaster, user1 } = await loadFixture(deployTestCrossChainPaymasterFixture));
      });

      it("should allow owner to set token price feed", async function () {
        const MockV3AggregatorFactory = await ethers.getContractFactory("contracts/test/mocks/MockV3Aggregator.sol:MockV3Aggregator");
        const newFeed = await MockV3AggregatorFactory.deploy(DECIMALS_8, 100_00000000n);

        const newToken = ethers.Wallet.createRandom().address;

        await expect(paymaster.setPriceFeed(newToken, await newFeed.getAddress()))
          .to.emit(paymaster, "PriceFeedUpdated")
          .withArgs(newToken, ZeroAddress, await newFeed.getAddress());

        expect(await paymaster.priceFeeds(newToken)).to.equal(await newFeed.getAddress());
      });

      it("should revert when non-owner tries to set price feed", async function () {
        const newToken = ethers.Wallet.createRandom().address;
        const newFeed = ethers.Wallet.createRandom().address;

        await expect(
          paymaster.connect(user1).setPriceFeed(newToken, newFeed)
        ).to.be.revertedWithCustomError(paymaster, "OwnableUnauthorizedAccount");
      });

      it("should revert when setting zero address feed", async function () {
        const newToken = ethers.Wallet.createRandom().address;

        await expect(
          paymaster.setPriceFeed(newToken, ZeroAddress)
        ).to.be.revertedWithCustomError(paymaster, "InvalidPriceFeed");
      });
    });

    describe("addRoseUsdFeed", function () {
      let paymaster: any;
      let user1: any;
      let roseUsdFeed1: any;

      beforeEach(async function () {
        ({ paymaster, user1, roseUsdFeed1 } = await loadFixture(deployTestCrossChainPaymasterFixture));
      });

      it("should allow owner to add ROSE/USD feed", async function () {
        const MockV3AggregatorFactory = await ethers.getContractFactory("contracts/test/mocks/MockV3Aggregator.sol:MockV3Aggregator");
        const newFeed = await MockV3AggregatorFactory.deploy(DECIMALS_8, 5_00000000n);

        const feedsBefore = await paymaster.getRoseUsdFeedCount();

        await expect(paymaster.addRoseUsdFeed(await newFeed.getAddress()))
          .to.emit(paymaster, "RoseUsdFeedAdded")
          .withArgs(await newFeed.getAddress());

        const feedsAfter = await paymaster.getRoseUsdFeedCount();
        expect(feedsAfter).to.equal(feedsBefore + 1n);

        const feeds = await paymaster.getRoseUsdFeeds();
        expect(feeds).to.include(await newFeed.getAddress());
      });

      it("should revert when adding duplicate feed", async function () {
        await expect(
          paymaster.addRoseUsdFeed(await roseUsdFeed1.getAddress())
        ).to.be.revertedWithCustomError(paymaster, "DuplicateRoseUsdFeed");
      });

      it("should revert when adding zero address", async function () {
        await expect(paymaster.addRoseUsdFeed(ZeroAddress)).to.be.revertedWithCustomError(
          paymaster,
          "InvalidPriceFeed"
        );
      });

      it("should revert when non-owner tries to add feed", async function () {
        const newFeed = ethers.Wallet.createRandom().address;

        await expect(
          paymaster.connect(user1).addRoseUsdFeed(newFeed)
        ).to.be.revertedWithCustomError(paymaster, "OwnableUnauthorizedAccount");
      });
    });

    describe("removeRoseUsdFeed", function () {
      let paymaster: any;
      let user1: any;
      let roseUsdFeed1: any;
      let roseUsdFeed2: any;
      let roseUsdFeed3: any;

      beforeEach(async function () {
        ({ paymaster, user1, roseUsdFeed1, roseUsdFeed2, roseUsdFeed3 } = await loadFixture(
          deployTestCrossChainPaymasterFixture
        ));
      });

      it("should allow owner to remove ROSE/USD feed", async function () {
        const feedsBefore = await paymaster.getRoseUsdFeedCount();

        await expect(paymaster.removeRoseUsdFeed(await roseUsdFeed3.getAddress()))
          .to.emit(paymaster, "RoseUsdFeedRemoved")
          .withArgs(await roseUsdFeed3.getAddress());

        const feedsAfter = await paymaster.getRoseUsdFeedCount();
        expect(feedsAfter).to.equal(feedsBefore - 1n);

        const feeds = await paymaster.getRoseUsdFeeds();
        expect(feeds).to.not.include(await roseUsdFeed3.getAddress());
      });

      it("should revert when trying to remove non-existent feed", async function () {
        const randomAddress = ethers.Wallet.createRandom().address;

        await expect(
          paymaster.removeRoseUsdFeed(randomAddress)
        ).to.be.revertedWithCustomError(paymaster, "RoseUsdFeedNotFound");
      });

      it("should revert when trying to remove last feed", async function () {
        // Remove all but one
        await paymaster.removeRoseUsdFeed(await roseUsdFeed2.getAddress());
        await paymaster.removeRoseUsdFeed(await roseUsdFeed3.getAddress());

        // Try to remove the last one
        await expect(
          paymaster.removeRoseUsdFeed(await roseUsdFeed1.getAddress())
        ).to.be.revertedWithCustomError(paymaster, "NoRoseUsdFeeds");
      });

      it("should revert when non-owner tries to remove feed", async function () {
        await expect(
          paymaster.connect(user1).removeRoseUsdFeed(await roseUsdFeed1.getAddress())
        ).to.be.revertedWithCustomError(paymaster, "OwnableUnauthorizedAccount");
      });
    });

    describe("setTokenDecimals", function () {
      let paymaster: any;
      let user1: any;

      beforeEach(async function () {
        ({ paymaster, user1 } = await loadFixture(deployTestCrossChainPaymasterFixture));
      });

      it("should allow owner to set token decimals", async function () {
        const newToken = ethers.Wallet.createRandom().address;

        await expect(paymaster.setTokenDecimals(newToken, 18))
          .to.emit(paymaster, "TokenDecimalsSet")
          .withArgs(newToken, 18);

        expect(await paymaster.tokenDecimals(newToken)).to.equal(18);
      });

      it("should revert when non-owner tries to set decimals", async function () {
        const newToken = ethers.Wallet.createRandom().address;

        await expect(
          paymaster.connect(user1).setTokenDecimals(newToken, 18)
        ).to.be.revertedWithCustomError(paymaster, "OwnableUnauthorizedAccount");
      });
    });

    describe("setStalenessThreshold", function () {
      let paymaster: any;
      let user1: any;

      beforeEach(async function () {
        ({ paymaster, user1 } = await loadFixture(deployTestCrossChainPaymasterFixture));
      });

      it("should allow owner to set staleness threshold", async function () {
        const newThreshold = 7200; // 2 hours

        await paymaster.setStalenessThreshold(newThreshold);

        expect(await paymaster.stalenessThreshold()).to.equal(newThreshold);
      });

      it("should revert when non-owner tries to set threshold", async function () {
        await expect(
          paymaster.connect(user1).setStalenessThreshold(7200)
        ).to.be.revertedWithCustomError(paymaster, "OwnableUnauthorizedAccount");
      });
    });
  });

  describe("Chain Configuration", function () {
    let paymaster: any;
    let user1: any;

    beforeEach(async function () {
      ({ paymaster, user1 } = await loadFixture(deployTestCrossChainPaymasterFixture));
    });

    it("should allow owner to set chain config", async function () {
      const chainId = 1n;
      const config = {
        chainId: 1,
        enabled: true,
        confirmations: 12,
        blockTime: 12,
        maxAmount: parseEther("1000"),
      };

      await paymaster.setChainConfig(chainId, config);

      const storedConfig = await paymaster.chainConfigs(chainId);
      expect(storedConfig.enabled).to.equal(config.enabled);
      expect(storedConfig.confirmations).to.equal(config.confirmations);
      expect(storedConfig.blockTime).to.equal(config.blockTime);
      expect(storedConfig.maxAmount).to.equal(config.maxAmount);
    });

    it("should revert when non-owner tries to set chain config", async function () {
      const config = {
        chainId: 1,
        enabled: true,
        confirmations: 12,
        blockTime: 12,
        maxAmount: parseEther("1000"),
      };

      await expect(
        paymaster.connect(user1).setChainConfig(1n, config)
      ).to.be.revertedWithCustomError(paymaster, "OwnableUnauthorizedAccount");
    });
  });

  describe("Vault Authorization", function () {
    let paymaster: any;
    let user1: any;
    let vault1: any;

    beforeEach(async function () {
      ({ paymaster, user1, vault1 } = await loadFixture(deployTestCrossChainPaymasterFixture));
    });

    it("should allow owner to authorize vault", async function () {
      const chainId = 1n;

      await expect(paymaster.setVaultAuthorization(chainId, vault1.address, true))
        .to.emit(paymaster, "VaultAuthorizationUpdated")
        .withArgs(chainId, vault1.address, true);

      expect(await paymaster.isAuthorizedVault(chainId, vault1.address)).to.be.true;
    });

    it("should allow owner to deauthorize vault", async function () {
      const chainId = 1n;

      await paymaster.setVaultAuthorization(chainId, vault1.address, true);
      await paymaster.setVaultAuthorization(chainId, vault1.address, false);

      expect(await paymaster.isAuthorizedVault(chainId, vault1.address)).to.be.false;
    });

    it("should revert when non-owner tries to set authorization", async function () {
      await expect(
        paymaster.connect(user1).setVaultAuthorization(1n, vault1.address, true)
      ).to.be.revertedWithCustomError(paymaster, "OwnableUnauthorizedAccount");
    });
  });

  describe("Distribution Limits", function () {
    let paymaster: any;
    let user1: any;

    beforeEach(async function () {
      ({ paymaster, user1 } = await loadFixture(deployTestCrossChainPaymasterFixture));
    });

    it("should allow owner to set distribution limits", async function () {
      const newDailyLimit = parseEther("2000");
      const newPerTxLimit = parseEther("200");

      await expect(paymaster.setDistributionLimits(newDailyLimit, newPerTxLimit, true))
        .to.emit(paymaster, "DistributionLimitsUpdated")
        .withArgs(newDailyLimit, newPerTxLimit, true);

      const limits = await paymaster.limits();
      expect(limits.dailyLimit).to.equal(newDailyLimit);
      expect(limits.perTxLimit).to.equal(newPerTxLimit);
      expect(limits.enabled).to.be.true;
    });

    it("should reset daily counter when changing limits", async function () {
      const newDailyLimit = parseEther("2000");
      const newPerTxLimit = parseEther("200");

      await paymaster.setDistributionLimits(newDailyLimit, newPerTxLimit, true);

      const limits = await paymaster.limits();
      expect(limits.currentDaily).to.equal(0);
    });

    it("should revert when non-owner tries to set limits", async function () {
      await expect(
        paymaster.connect(user1).setDistributionLimits(DAILY_LIMIT, PER_TX_LIMIT, true)
      ).to.be.revertedWithCustomError(paymaster, "OwnableUnauthorizedAccount");
    });
  });

  describe("Pause/Unpause", function () {
    let paymaster: any;
    let user1: any;

    beforeEach(async function () {
      ({ paymaster, user1 } = await loadFixture(deployTestCrossChainPaymasterFixture));
    });

    it("should allow owner to pause", async function () {
      await paymaster.pause();

      expect(await paymaster.paused()).to.be.true;
    });

    it("should allow owner to unpause", async function () {
      await paymaster.pause();
      await paymaster.unpause();

      expect(await paymaster.paused()).to.be.false;
    });

    it("should revert when non-owner tries to pause", async function () {
      await expect(paymaster.connect(user1).pause()).to.be.revertedWithCustomError(
        paymaster,
        "OwnableUnauthorizedAccount"
      );
    });

    it("should revert when non-owner tries to unpause", async function () {
      await paymaster.pause();

      await expect(paymaster.connect(user1).unpause()).to.be.revertedWithCustomError(
        paymaster,
        "OwnableUnauthorizedAccount"
      );
    });
  });

  describe("Withdraw ROSE", function () {
    let paymaster: any;
    let owner: any;
    let user1: any;
    let user2: any;

    beforeEach(async function () {
      ({ paymaster, owner, user1, user2 } = await loadFixture(deployTestCrossChainPaymasterFixture));
    });

    it("should allow owner to withdraw ROSE", async function () {
      const withdrawAmount = parseEther("100");
      const balanceBefore = await ethers.provider.getBalance(user1.address);

      await expect(paymaster.withdrawRose(user1.address, withdrawAmount))
        .to.emit(paymaster, "RoseWithdrawn")
        .withArgs(user1.address, withdrawAmount, owner.address);

      const balanceAfter = await ethers.provider.getBalance(user1.address);
      expect(balanceAfter - balanceBefore).to.equal(withdrawAmount);
    });

    it("should revert when withdrawing to zero address", async function () {
      await expect(
        paymaster.withdrawRose(ZeroAddress, parseEther("100"))
      ).to.be.revertedWithCustomError(paymaster, "ZeroAddress");
    });

    it("should revert when withdrawing zero amount", async function () {
      await expect(paymaster.withdrawRose(user1.address, 0n)).to.be.revertedWithCustomError(
        paymaster,
        "InvalidAmount"
      );
    });

    it("should revert when withdrawing more than balance", async function () {
      const balance = await ethers.provider.getBalance(await paymaster.getAddress());
      const tooMuch = balance + parseEther("1");

      await expect(
        paymaster.withdrawRose(user1.address, tooMuch)
      ).to.be.revertedWithCustomError(paymaster, "InsufficientBalance");
    });

    it("should revert when non-owner tries to withdraw", async function () {
      await expect(
        paymaster.connect(user1).withdrawRose(user2.address, parseEther("100"))
      ).to.be.revertedWithCustomError(paymaster, "OwnableUnauthorizedAccount");
    });
  });

  describe("View Functions", function () {
    describe("calculateRoseAmount", function () {
      let paymaster: any;
      let mockToken: any;
      let tokenUsdFeed: any;
      let roseUsdFeed: any;

      beforeEach(async function () {
        ({ paymaster, mockToken, tokenUsdFeed, roseUsdFeed } = await loadFixture(
          deploySimpleTestFixture
        ));
      });

      it("should return correct ROSE amount calculation", async function () {
        const tokenAmount = 100_000000n; // 100 USDC
        const tokenPrice = 1_00000000n; // $1.00
        const rosePrice = 5_00000000n; // $5.00

        await tokenUsdFeed.updateAnswer(tokenPrice);
        await roseUsdFeed.updateAnswer(rosePrice);

        const result = await paymaster.calculateRoseAmount(
          await mockToken.getAddress(),
          tokenAmount
        );

        // Result should be positive and reasonable
        expect(result).to.be.gt(0);
        // 100 USDC at $1 each = $100, at $5 per ROSE = 20 ROSE
        expect(result).to.be.gte(parseEther("10")); // At least 10 ROSE
      });
    });

    describe("other view functions", function () {
      let paymaster: any;

      beforeEach(async function () {
        ({ paymaster } = await loadFixture(deployTestCrossChainPaymasterFixture));
      });

      it("should return false for unprocessed payment", async function () {
        const randomPaymentId = ethers.hexlify(ethers.randomBytes(32));

        expect(await paymaster.isPaymentProcessed(randomPaymentId)).to.be.false;
      });

      it("should return correct ROSE/USD feed count", async function () {
        expect(await paymaster.getRoseUsdFeedCount()).to.equal(3);
      });

      it("should return ROSE/USD feed at index", async function () {
        const feedAtIndex0 = await paymaster.getRoseUsdFeedAt(0);
        const feeds = await paymaster.getRoseUsdFeeds();

        expect(feeds[0]).to.equal(feedAtIndex0);
      });
    });
  });

  describe("Receive Function", function () {
    let paymaster: any;
    let user1: any;

    beforeEach(async function () {
      ({ paymaster, user1 } = await loadFixture(deployTestCrossChainPaymasterFixture));
    });

    it("should accept ROSE transfers", async function () {
      const amount = parseEther("100");
      const balanceBefore = await ethers.provider.getBalance(await paymaster.getAddress());

      await user1.sendTransaction({
        to: await paymaster.getAddress(),
        value: amount,
      });

      const balanceAfter = await ethers.provider.getBalance(await paymaster.getAddress());
      expect(balanceAfter - balanceBefore).to.equal(amount);
    });
  });
});
