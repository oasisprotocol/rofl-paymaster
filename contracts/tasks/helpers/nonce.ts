/**
 * Nonce synchronization helpers for L2 chains (Arbitrum, etc.)
 * where RPC nodes may return stale nonce values after transactions.
 */

import { ethers } from "ethers";

/**
 * Wait for nonce to reach expected value. Useful after a transaction
 * when the next transaction needs the updated nonce.
 */
export async function waitForNonce(
  provider: ethers.Provider,
  address: string,
  expected: number
): Promise<number> {
  for (let i = 0; i < 10; i++) {
    const nonce = await provider.getTransactionCount(address, "pending");
    if (nonce >= expected) return nonce;
    console.log(`  Waiting for nonce sync... (${nonce}/${expected})`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Nonce sync timeout: expected ${expected}`);
}

/**
 * Execute multiple transactions sequentially with nonce sync between each.
 * Returns array of transaction responses.
 */
export async function executeWithNonceSync<T extends ethers.TransactionResponse>(
  signer: ethers.Signer,
  txFns: (() => Promise<T>)[]
): Promise<T[]> {
  const provider = signer.provider;
  if (!provider) throw new Error("Signer must have a provider");

  const results: T[] = [];
  for (const txFn of txFns) {
    const tx = await txFn();
    await tx.wait();
    results.push(tx);

    // Wait for nonce sync before next tx
    if (txFns.indexOf(txFn) < txFns.length - 1) {
      await waitForNonce(provider, await signer.getAddress(), tx.nonce + 1);
    }
  }
  return results;
}
