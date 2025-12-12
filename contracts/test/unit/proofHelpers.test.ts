import { expect } from "chai";
import { AbiCoder, decodeRlp, hexlify, zeroPadValue } from "ethers";
import {
  createMockReceiptProof,
  calculatePaymentId,
  PAYMENT_INITIATED_TOPIC,
} from "../helpers/proofHelpers";

describe("proofHelpers", function () {
  describe("createMockReceiptProof", function () {
    const mockParams = {
      chainId: 1n,
      blockNumber: 100n,
      transactionIndex: 5,
      logIndex: 0,
      vault: "0x1234567890123456789012345678901234567890",
      payer: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      recipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      token: "0xcccccccccccccccccccccccccccccccccccccccc",
      amount: 1000000n,
      paymentId: "0x" + "00".repeat(32),
    };

    it("should return valid proof structure", function () {
      const proof = createMockReceiptProof(mockParams);

      expect(proof.chainId).to.equal(mockParams.chainId);
      expect(proof.blockNumber).to.equal(mockParams.blockNumber);
      expect(proof.blockHeader).to.equal("0x");
      expect(proof.ancestry).to.deep.equal([]);
      expect(proof.logIndex).to.equal(mockParams.logIndex);
    });

    it("should encode transactionIndex as RLP", function () {
      const proof = createMockReceiptProof(mockParams);

      // transactionIndex = 5, which is 0x05, single byte < 0x80
      expect(proof.transactionIndex).to.equal("0x05");
    });

    it("should encode transactionIndex 0 as 0x80", function () {
      const proof = createMockReceiptProof({ ...mockParams, transactionIndex: 0 });
      expect(proof.transactionIndex).to.equal("0x80");
    });

    it("should produce RLP-decodable log", function () {
      const proof = createMockReceiptProof(mockParams);

      // Should be decodable without throwing
      const decoded = decodeRlp(proof.log);
      expect(Array.isArray(decoded)).to.be.true;
      expect(decoded.length).to.equal(3); // [address, topics[], data]
    });

    it("should encode log address correctly", function () {
      const proof = createMockReceiptProof(mockParams);
      const decoded = decodeRlp(proof.log) as string[];

      // First element is the vault address
      expect(hexlify(decoded[0]).toLowerCase()).to.equal(mockParams.vault.toLowerCase());
    });

    it("should include correct number of topics", function () {
      const proof = createMockReceiptProof(mockParams);
      const decoded = decodeRlp(proof.log) as unknown[];

      // Topics: [event_sig, payer, recipient, token]
      expect((decoded[1] as unknown[]).length).to.equal(4);
    });

    it("should encode topics and data payload correctly", function () {
      const proof = createMockReceiptProof(mockParams);
      const decoded = decodeRlp(proof.log) as unknown[];
      const topics = decoded[1] as unknown[];

      expect(hexlify(topics[0]).toLowerCase()).to.equal(PAYMENT_INITIATED_TOPIC.toLowerCase());
      expect(hexlify(topics[1]).toLowerCase()).to.equal(
        zeroPadValue(mockParams.payer, 32).toLowerCase()
      );
      expect(hexlify(topics[2]).toLowerCase()).to.equal(
        zeroPadValue(mockParams.recipient, 32).toLowerCase()
      );
      expect(hexlify(topics[3]).toLowerCase()).to.equal(
        zeroPadValue(mockParams.token, 32).toLowerCase()
      );

      const [amount, paymentId] = AbiCoder.defaultAbiCoder().decode(
        ["uint256", "bytes32"],
        decoded[2]
      );
      expect(amount).to.equal(mockParams.amount);
      expect(paymentId).to.equal(mockParams.paymentId);
    });
  });

  describe("calculatePaymentId", function () {
    it("should return consistent payment ID", function () {
      const params = {
        chainId: 1n,
        vault: "0x1234567890123456789012345678901234567890",
        blockNumber: 100n,
        transactionIndex: 5,
        logIndex: 0,
      };

      const id1 = calculatePaymentId(params);
      const id2 = calculatePaymentId(params);

      expect(id1).to.equal(id2);
      expect(id1).to.have.length(66); // 0x + 64 hex chars
    });

    it("should return different IDs for different inputs", function () {
      const params1 = {
        chainId: 1n,
        vault: "0x1234567890123456789012345678901234567890",
        blockNumber: 100n,
        transactionIndex: 5,
        logIndex: 0,
      };
      const params2 = { ...params1, blockNumber: 101n };

      const id1 = calculatePaymentId(params1);
      const id2 = calculatePaymentId(params2);

      expect(id1).to.not.equal(id2);
    });
  });

  describe("PAYMENT_INITIATED_TOPIC", function () {
    it("should be a valid 32-byte keccak256 hash", function () {
      expect(PAYMENT_INITIATED_TOPIC).to.have.length(66); // 0x + 64 hex chars
      expect(PAYMENT_INITIATED_TOPIC).to.match(/^0x[a-f0-9]{64}$/i);
    });
  });
});
