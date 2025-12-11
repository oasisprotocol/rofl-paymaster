import { keccak256, AbiCoder, zeroPadValue, toBeHex } from "ethers";

/**
 * Helper functions for creating mock receipt proofs
 */

// PaymentInitiated event signature
export const PAYMENT_INITIATED_TOPIC = keccak256(
  Buffer.from("PaymentInitiated(address,address,address,uint256,bytes32)")
);

/**
 * Creates a mock ReceiptProof structure
 * @param params Proof parameters
 * @returns Mock ReceiptProof object
 */
export function createMockReceiptProof(params: {
  chainId: bigint;
  blockNumber: bigint;
  transactionIndex: number;
  logIndex: number;
  vault: string;
  payer: string;
  recipient: string;
  token: string;
  amount: bigint;
  paymentId: string;
}): {
  chainId: bigint;
  blockNumber: bigint;
  blockHeader: string;
  ancestry: string[];
  transactionIndex: string;
  logIndex: number;
  log: string;
} {
  const {
    chainId,
    blockNumber,
    transactionIndex,
    logIndex,
    vault,
    payer,
    recipient,
    token,
    amount,
    paymentId,
  } = params;

  // Encode the log entry as RLP: [address, topics[], data]
  const log = encodeMockLog(vault, payer, recipient, token, amount, paymentId);

  // Encode transaction index as RLP
  const txIndex = encodeRlpUint(transactionIndex);

  return {
    chainId,
    blockNumber,
    blockHeader: "0x", // Mock block header (not validated in this test)
    ancestry: [], // Mock ancestry (not validated in this test)
    transactionIndex: txIndex,
    logIndex,
    log,
  };
}

/**
 * Encodes a mock log entry in RLP format
 * @param vault Vault address
 * @param payer Payer address
 * @param recipient Recipient address
 * @param token Token address
 * @param amount Token amount
 * @param paymentId Payment ID
 * @returns RLP-encoded log entry
 */
function encodeMockLog(
  vault: string,
  payer: string,
  recipient: string,
  token: string,
  amount: bigint,
  paymentId: string
): string {
  // Topics: [signature, indexed_payer, indexed_recipient, indexed_token]
  const topics = [
    PAYMENT_INITIATED_TOPIC,
    zeroPadValue(payer, 32),
    zeroPadValue(recipient, 32),
    zeroPadValue(token, 32),
  ];

  // Data: abi.encode(amount, paymentId)
  const abiCoder = AbiCoder.defaultAbiCoder();
  const data = abiCoder.encode(["uint256", "bytes32"], [amount, paymentId]);

  // Encode as RLP: [address, topics[], data]
  // For simplicity, we'll use a basic hex encoding that mimics RLP structure
  // In a real implementation, you'd use a proper RLP library

  // This is a simplified version - in production tests, you'd use actual RLP encoding
  const addressRlp = encodeRlpBytes(vault);
  const topicsRlp = encodeRlpList(topics.map((t) => encodeRlpBytes(t)));
  const dataRlp = encodeRlpBytes(data);

  return encodeRlpList([addressRlp, topicsRlp, dataRlp]);
}

/**
 * Simple RLP encoding for bytes (simplified - use rlp library for production)
 */
function encodeRlpBytes(data: string): string {
  // Remove 0x prefix if present
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  const bytes = Buffer.from(hex, "hex");

  if (bytes.length === 1 && bytes[0] < 0x80) {
    return "0x" + hex;
  } else if (bytes.length < 56) {
    const prefix = (0x80 + bytes.length).toString(16).padStart(2, "0");
    return "0x" + prefix + hex;
  } else {
    const lengthHex = bytes.length.toString(16);
    const lengthOfLength = Math.ceil(lengthHex.length / 2);
    const prefix = (0xb7 + lengthOfLength).toString(16).padStart(2, "0");
    return "0x" + prefix + lengthHex.padStart(lengthOfLength * 2, "0") + hex;
  }
}

/**
 * Simple RLP encoding for lists (simplified - use rlp library for production)
 */
function encodeRlpList(items: string[]): string {
  const concatenated = items.map((item) => item.slice(2)).join("");
  const totalLength = concatenated.length / 2;

  if (totalLength < 56) {
    const prefix = (0xc0 + totalLength).toString(16).padStart(2, "0");
    return "0x" + prefix + concatenated;
  } else {
    const lengthHex = totalLength.toString(16);
    const lengthOfLength = Math.ceil(lengthHex.length / 2);
    const prefix = (0xf7 + lengthOfLength).toString(16).padStart(2, "0");
    return "0x" + prefix + lengthHex.padStart(lengthOfLength * 2, "0") + concatenated;
  }
}

/**
 * Encodes a uint as RLP (simplified)
 */
function encodeRlpUint(value: number): string {
  if (value === 0) return "0x80";

  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = "0" + hex;

  const bytes = Buffer.from(hex, "hex");

  if (bytes.length === 1 && bytes[0] < 0x80) {
    return "0x" + hex;
  } else if (bytes.length < 56) {
    const prefix = (0x80 + bytes.length).toString(16).padStart(2, "0");
    return "0x" + prefix + hex;
  } else {
    const lengthHex = bytes.length.toString(16);
    const lengthOfLength = Math.ceil(lengthHex.length / 2);
    const prefix = (0xb7 + lengthOfLength).toString(16).padStart(2, "0");
    return "0x" + prefix + lengthHex.padStart(lengthOfLength * 2, "0") + hex;
  }
}

/**
 * Calculates payment ID from proof parameters
 * @param params Payment proof parameters
 * @returns Payment ID
 */
export function calculatePaymentId(params: {
  chainId: bigint;
  vault: string;
  blockNumber: bigint;
  transactionIndex: number;
  logIndex: number;
}): string {
  const abiCoder = AbiCoder.defaultAbiCoder();
  const encoded = abiCoder.encode(
    ["uint256", "address", "uint256", "uint256", "uint256"],
    [params.chainId, params.vault, params.blockNumber, params.transactionIndex, params.logIndex]
  );
  return keccak256(encoded);
}
