import { keccak256, AbiCoder, zeroPadValue, toBeHex, encodeRlp, getBytes } from "ethers";

/**
 * Helper functions for creating mock receipt proofs.
 * Uses ethers v6's native RLP encoding for correctness and maintainability.
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
 * Encodes a mock log entry in RLP format.
 * RLP log structure: [address, topics[], data]
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
  // ethers.encodeRlp handles nested arrays and bytes correctly
  return encodeRlp([getBytes(vault), topics.map((t) => getBytes(t)), getBytes(data)]);
}

/**
 * Encodes a uint as RLP using ethers native encoding.
 * RLP encodes 0 as 0x80 (empty byte string), otherwise as minimal byte representation.
 */
function encodeRlpUint(value: number): string {
  if (value === 0) return encodeRlp(new Uint8Array(0));
  return encodeRlp(getBytes(toBeHex(value)));
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
