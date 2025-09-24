import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Trie } from "@ethereumjs/trie";
import { RLP } from "@ethereumjs/rlp";
import {
  bytesToHex,
  concatBytes,
  hexToBytes,
  hexToBigInt,
  bytesToInt,
  intToBytes,
  intToHex,
} from "@ethereumjs/util";
import { createBlockHeaderFromRPC } from "@ethereumjs/block";
import { Common, Sepolia, createCustomCommon, Hardfork } from "@ethereumjs/common";

// Helper: encode transaction index for trie key
const encodeIndex = (_index: string) =>
  _index === "0x0"
    ? RLP.encode(Buffer.alloc(0))
    : RLP.encode(bytesToInt(hexToBytes((_index as `0x${string}`) ?? "0x0")));

task("pay:generate-proof", "Generate Merkle proof for PaymentInitiated event")
  .addParam("txHash", "Transaction hash containing the PaymentInitiated event")
  .addOptionalParam("logIndex", "Log index of PaymentInitiated event (auto-detect if omitted)")
  .setAction(async (args, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;

    console.log("🧮 Generating proof for PaymentInitiated");
    console.log("Transaction hash:", args.txHash);
    console.log("Network:", hre.network.name);

    const networkConfig = hre.network.config as any;
    if (!networkConfig.url) throw new Error(`No RPC URL configured for network: ${hre.network.name}`);

    const provider = new ethers.JsonRpcProvider(networkConfig.url);

    try {
      // 1) Fetch receipt and block
      console.log("📥 Fetching transaction receipt...");
      const receipt = await provider.getTransactionReceipt(args.txHash);
      if (!receipt) throw new Error("Transaction receipt not found");
      console.log(`  Block: ${receipt.blockNumber}, Tx index: ${(receipt as any).index}`);

      console.log("📦 Fetching block header...");
      const blockHex = `0x${receipt.blockNumber.toString(16)}`;
      const block = await provider.send("eth_getBlockByNumber", [blockHex, true]);
      if (!block) throw new Error("Block not found");
      console.log(`  Block hash: ${block.hash}`);

      // 2) Locate PaymentInitiated log index if not provided
      let eventLogIndex = args.logIndex !== undefined ? Number(args.logIndex) : undefined;
      if (eventLogIndex === undefined) {
        console.log("\n🔍 Auto-detecting PaymentInitiated log...");
        const vaultInterface = new ethers.Interface([
          "event PaymentInitiated(address indexed payer, address indexed recipient, address indexed token, uint256 amount, bytes32 paymentId)",
        ]);
        for (let i = 0; i < receipt.logs.length; i++) {
          try {
            const parsed = vaultInterface.parseLog(receipt.logs[i]);
            if (parsed && parsed.name === "PaymentInitiated") {
              eventLogIndex = i;
              console.log(`  Found PaymentInitiated at log index ${i}`);
              break;
            }
          } catch {}
        }
        if (eventLogIndex === undefined) throw new Error("PaymentInitiated log not found in transaction");
      }

      // 3) Build merkle proof over receipts
      console.log("\n🧮 Building cryptographic proof...");
      const chainId = Number((await provider.getNetwork()).chainId);

      const common =
        chainId === 11155111
          ? new Common({ chain: Sepolia })
          : createCustomCommon({ chainId }, Sepolia, { hardfork: Hardfork.Cancun, eips: [7685] });

      // Fetch all receipts in the block
      console.log("📥 Fetching receipts...");
      const receipts = await Promise.all(
        block.transactions.map(async (tx: any) => {
          const txHash = typeof tx === "string" ? tx : tx.hash;
          return await provider.send("eth_getTransactionReceipt", [txHash]);
        })
      );
      console.log(`  Found ${receipts.filter((r) => r).length} receipts`);

      // Encode receipts
      console.log("🔐 Encoding receipts...");
      const encodedReceipts = receipts.map((_r: any) => {
        const type = Number(hexToBigInt(_r.type || "0x0"));
        const encoded = RLP.encode([
          _r.status === "0x1" ? hexToBytes("0x01") : Uint8Array.from([]),
          hexToBytes(_r.cumulativeGasUsed),
          hexToBytes(_r.logsBloom),
          _r.logs.map((_log: any) => [hexToBytes(_log.address), _log.topics.map(hexToBytes), hexToBytes(_log.data)]),
        ]);
        if (type === 0) return encoded;
        return concatBytes(intToBytes(type), encoded);
      });

      // Build receipt trie
      console.log("🌳 Building receipts trie...");
      const trie = new Trie();
      await Promise.all(
        receipts.map((_r: any, _i: number) => trie.put(encodeIndex(_r.transactionIndex), encodedReceipts[_i]))
      );

      const calculatedRoot = bytesToHex(trie.root());
      if (calculatedRoot !== block.receiptsRoot) {
        throw new Error(`Trie root mismatch. Calculated ${calculatedRoot}, Block ${block.receiptsRoot}`);
      }

      // Create proof for the specific transaction index
      const txIndexKey = encodeIndex(intToHex((receipt as any).index));
      const merkleProof = await trie.createProof(txIndexKey);

      // Block header encoding
      const blockHeader = createBlockHeaderFromRPC(block, { common });
      const encodedBlockHeader = bytesToHex(blockHeader.serialize());
      const headerHash = ethers.keccak256(hexToBytes(encodedBlockHeader));
      if (headerHash !== block.hash) throw new Error(`Header hash mismatch: ${headerHash} vs ${block.hash}`);

      const blockNumber = Number(receipt.blockNumber);
      const logIndex = Number(eventLogIndex);

      // Hashi ReceiptProof tuple (array form for JSON):
      // [chainId, blockNumber, blockHeader, ancestralBlockNumber, ancestralBlockHeaders, receiptProof, transactionIndex, logIndex]
      const proof = [
        chainId,
        blockNumber,
        encodedBlockHeader,
        0,
        [],
        merkleProof.map((n) => bytesToHex(n)),
        bytesToHex(txIndexKey),
        logIndex,
      ];

      const proofPath = "proof.json";
      require("fs").writeFileSync(proofPath, JSON.stringify(proof, null, 2));

      console.log("\n✅ Proof generated");
      console.log("📋 Summary:");
      console.log(`  Chain ID: ${chainId}`);
      console.log(`  Block Number: ${blockNumber}`);
      console.log(`  Tx Index: ${Number((receipt as any).index)}`);
      console.log(`  Log Index: ${logIndex}`);
      console.log(`  Merkle Nodes: ${merkleProof.length}`);
      console.log(`  Saved: ${proofPath}`);

      console.log("\n💡 Next step:");
      console.log(
        `bunx hardhat pay:relay --network <sapphireNetwork>`
      );

      return {
        proof,
        blockHash: block.hash,
        blockNumber,
        transactionIndex: Number((receipt as any).index),
        logIndex,
      };
    } catch (err: any) {
      console.error("❌ Error generating proof:", err?.message || err);
      throw err;
    }
  });

