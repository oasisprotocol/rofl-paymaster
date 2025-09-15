import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { JsonRpcProvider } from "ethers";

task("post-blockhash", "Post block hash to mock oracle contract (MockAdapter or MockShoyuBashi)")
  .addParam("chainId", "Source chain ID")
  .addParam("blockNumber", "Block number from source chain")
  .addOptionalParam("blockHash", "Block hash (optional - will fetch from source RPC if not provided)")
  .addOptionalParam("sourceRpc", "Source chain RPC URL (required if blockHash not provided)")
  .addOptionalParam("contract", "Mock contract address (MockAdapter or MockShoyuBashi)", "0x9f983F759d511D0f404582b0bdc1994edb5db856")
  .addOptionalParam("type", "Contract type: 'adapter' or 'shoyubashi' (default: 'adapter')", "adapter")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;
    
    console.log("🔗 Posting block hash to mock oracle contract on", hre.network.name);
    console.log("Contract:", taskArgs.contract);
    console.log("Source Chain ID:", taskArgs.chainId);
    console.log("Source Block Number:", taskArgs.blockNumber);
    
    let blockHash = taskArgs.blockHash;
    
    // If no block hash provided, fetch from source chain RPC (simulating ROFL oracle behavior)
    if (!blockHash) {
      if (!taskArgs.sourceRpc) {
        // Try to auto-detect RPC based on chainId using Alchemy URLs
        const alchemyKey = process.env.ALCHEMY_API_KEY;
        const defaultRpcs: { [key: string]: string } = {
          "1": alchemyKey ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}` : "https://eth.llamarpc.com", // Ethereum Mainnet
          "11155111": alchemyKey ? `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}` : "https://rpc.sepolia.org", // Sepolia
          "17000": alchemyKey ? `https://eth-holesky.g.alchemy.com/v2/${alchemyKey}` : "https://rpc.holesky.io", // Holesky
          "10": alchemyKey ? `https://opt-mainnet.g.alchemy.com/v2/${alchemyKey}` : "https://mainnet.optimism.io", // Optimism
          "8453": alchemyKey ? `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}` : "https://mainnet.base.org", // Base
          "42161": alchemyKey ? `https://arb-mainnet.g.alchemy.com/v2/${alchemyKey}` : "https://arb1.arbitrum.io/rpc", // Arbitrum
        };
        
        const chainIdStr = taskArgs.chainId.toString();
        if (defaultRpcs[chainIdStr]) {
          taskArgs.sourceRpc = defaultRpcs[chainIdStr];
          const displayUrl = taskArgs.sourceRpc.includes('alchemy') 
            ? taskArgs.sourceRpc.replace(/\/v2\/.*$/, '/v2/***') 
            : taskArgs.sourceRpc;
          console.log(`📡 Using default RPC for chain ${taskArgs.chainId}: ${displayUrl}`);
        } else {
          throw new Error("Either blockHash or sourceRpc must be provided. Common RPC URLs:\n" +
            "  - Sepolia (11155111): https://rpc.sepolia.org\n" +
            "  - Holesky (17000): https://rpc.holesky.io\n" +
            "  - Or check your network's Hardhat config for RPC URLs");
        }
      }
      
      console.log("📡 Fetching block hash from source chain (simulating ROFL oracle)...");
      console.log("Source RPC:", taskArgs.sourceRpc);
      
      try {
        // Create provider for source chain
        const sourceProvider = new JsonRpcProvider(taskArgs.sourceRpc);
        
        // Fetch block by number - this gets the canonical block hash
        const block = await sourceProvider.getBlock(parseInt(taskArgs.blockNumber));
        
        if (!block) {
          throw new Error(`Block ${taskArgs.blockNumber} not found on source chain`);
        }
        
        blockHash = block.hash;
        console.log("✅ Fetched block hash from source chain:", blockHash);
        console.log("   Block timestamp:", new Date(block.timestamp * 1000).toISOString());
        console.log("   Block transactions:", block.transactions.length);
        
        // This is exactly what the ROFL oracle would submit
        console.log("\n📋 This canonical block hash matches what ROFL oracle submits");
        
      } catch (error: any) {
        console.error("❌ Error fetching block from source chain:", error.message || error);
        console.log("\n💡 Troubleshooting tips:");
        console.log("   - Ensure the source RPC URL is correct and accessible");
        console.log("   - Check if block", taskArgs.blockNumber, "exists on chain", taskArgs.chainId);
        console.log("   - For rate limits, try alternative RPCs");
        throw error;
      }
    }
    
    console.log("Block Hash to post:", blockHash);
    
    const contractType = taskArgs.type;
    console.log(`📝 Using contract type: ${contractType}`);
    
    if (contractType === "adapter") {
      // Handle MockAdapter
      console.log("🔧 Posting to MockAdapter using setHashes()...");
      
      // Define minimal ABI for MockAdapter functions
      const mockAdapterABI = [
        "function setHashes(uint256 domain, uint256[] memory ids, bytes32[] memory hashes) external",
        "function getHash(uint256 domain, uint256 id) external view returns (bytes32)"
      ];
      
      const [signer] = await ethers.getSigners();
      const mockAdapter = new ethers.Contract(taskArgs.contract, mockAdapterABI, signer);
      
      // Prepare arrays for MockAdapter
      const blockNumbers = [parseInt(taskArgs.blockNumber)];
      const blockHashes = [blockHash];
      
      // Post the hash - ensure proper number conversion
      const tx = await mockAdapter.setHashes(
        parseInt(taskArgs.chainId),
        blockNumbers, 
        blockHashes
      );
      
      console.log("📤 Transaction sent:", tx.hash);
      await tx.wait();
      console.log("✅ Block hash posted successfully to MockAdapter!");
      
      // Verify it was stored
      const storedHash = await mockAdapter.getHash(parseInt(taskArgs.chainId), parseInt(taskArgs.blockNumber));
      console.log("🔍 Verification - stored hash:", storedHash);
      console.log("✅ Match:", storedHash === blockHash ? "YES" : "NO");
      
    } else if (contractType === "shoyubashi") {
      // Handle MockShoyuBashi
      console.log("🔧 Posting to MockShoyuBashi using setThresholdHash()...");
      
      const MockShoyuBashi = await ethers.getContractFactory("MockShoyuBashi");
      const mockShoyuBashi = MockShoyuBashi.attach(taskArgs.contract) as any;
      
      // Post the hash (MockShoyuBashi takes single values, not arrays)
      const tx = await mockShoyuBashi.setThresholdHash(
        parseInt(taskArgs.chainId),
        parseInt(taskArgs.blockNumber),
        blockHash
      );
      
      console.log("📤 Transaction sent:", tx.hash);
      await tx.wait();
      console.log("✅ Block hash posted successfully to MockShoyuBashi!");
      
      // Verify it was stored
      const storedHash = await mockShoyuBashi.getThresholdHash(parseInt(taskArgs.chainId), parseInt(taskArgs.blockNumber));
      console.log("🔍 Verification - stored hash:", storedHash);
      console.log("✅ Match:", storedHash === blockHash ? "YES" : "NO");
      
    } else {
      throw new Error(`Unknown contract type: ${contractType}. Use 'adapter' or 'shoyubashi'.`);
    }
    
    console.log("\n💡 Usage Notes:");
    if (contractType === "adapter") {
      console.log("  MockAdapter is typically used with custom HashiProver implementations");
      console.log("  that directly query specific adapter contracts for block hashes.");
    } else {
      console.log("  MockShoyuBashi implements the IShoyuBashi interface used by HashiProver");
      console.log("  and is the recommended mock for testing PingReceiver contracts.");
    }
  });