import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

// Deposit ERC20 into PaymasterVault and emit Hashi-proofable PaymentInitiated
// Usage:
// bun hardhat pay:deposit \
//   --network baseSepolia \
//   --vault 0xVault... \
//   --token 0xErc20... \
//   --amount 100 \
//   --recipient 0xRecipientOnSapphire... \
//   [--decimals 6] [--from 0x...] [--noapprove]

task("pay:deposit", "Deposit ERC20 into PaymasterVault and emit PaymentInitiated")
  .addOptionalParam("amount", "Amount in whole tokens (uses --decimals / env to parse)", "1")
  .addOptionalParam("recipient", "Recipient address on Sapphire (defaults to sender)")
  .addOptionalParam("vault", "PaymasterVault proxy address on the source chain (or set PAYMASTER_VAULT_PROXY)")
  .addOptionalParam("token", "ERC20 token address to deposit (or set PAYMASTER_VAULT_TOKEN)")
  .addOptionalParam("decimals", "Token decimals (auto-detected, or set PAYMASTER_VAULT_TOKEN_DECIMALS)")
  .addOptionalParam("from", "Sender address (defaults to first signer)")
  .addFlag("noapprove", "Do not auto-approve if allowance is insufficient (approval is default)")
  .setAction(async (args: any, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;

    const vaultAddr: string = args.vault ?? process.env.PAYMASTER_VAULT_PROXY as string;
    if (!vaultAddr) throw new Error("Missing --vault and PAYMASTER_VAULT_PROXY env");

    const tokenAddr: string = args.token ?? process.env.PAYMASTER_VAULT_TOKEN;
    if (!tokenAddr) throw new Error("Missing --token and PAYMASTER_VAULT_TOKEN env");
    const amountStr: string = args.amount;

    // Get signer
    const signers = await ethers.getSigners();
    let signer = signers[0];
    if (args.from) {
      const found = signers.find((s) => s.address.toLowerCase() === String(args.from).toLowerCase());
      if (!found) throw new Error(`Signer not found: ${args.from}`);
      signer = found;
    }

    console.log("🪙 Paymaster Deposit");
    console.log("Network:", hre.network.name);
    console.log("From:", signer.address);
    console.log("Vault:", vaultAddr);
    console.log("Token:", tokenAddr);
    // Resolve recipient default (same as --from signer if omitted)
    const recipient: string = args.recipient ?? signer.address;
    console.log("Recipient (Sapphire):", recipient);

    // Resolve decimals (prefer explicit, else attempt on-chain detection, fallback 18)
    let decimals: number | undefined = args.decimals ? parseInt(args.decimals) : (process.env.PAYMASTER_VAULT_TOKEN_DECIMALS ? parseInt(process.env.PAYMASTER_VAULT_TOKEN_DECIMALS) : undefined);
    if (Number.isNaN(decimals as number)) decimals = undefined;
    if (decimals === undefined) {
      try {
        const erc20 = new ethers.Contract(tokenAddr, ["function decimals() view returns (uint8)"], signer);
        decimals = Number(await erc20.decimals());
      } catch {
        decimals = 18;
      }
    }
    if (decimals! < 0 || decimals! > 18) throw new Error("decimals must be between 0 and 18");
    console.log("Token decimals:", decimals);

    const amount = ethers.parseUnits(amountStr, decimals);
    console.log("Amount (parsed):", amount.toString());

    // Contracts
    const vault = await ethers.getContractAt("PaymasterVault", vaultAddr, signer);
    const IERC20_ABI = [
      "function approve(address spender, uint256 value) external returns (bool)",
      "function allowance(address owner, address spender) view returns (uint256)",
      "function balanceOf(address owner) view returns (uint256)"
    ];
    const token = new ethers.Contract(tokenAddr, IERC20_ABI, signer);

    // Check balance
    const bal: bigint = await token.balanceOf(signer.address);
    console.log("Balance:", bal.toString());
    if (bal < amount) {
      throw new Error(`Insufficient token balance. Have ${bal.toString()}, need ${amount.toString()}`);
    }

    // Ensure allowance
    const allowance: bigint = await token.allowance(signer.address, vaultAddr);
    console.log("Allowance:", allowance.toString());
    if (allowance < amount) {
      if (args.noapprove) {
        throw new Error("Allowance insufficient. Re-run without --noapprove to auto-approve the vault");
      }
      console.log("\n✅ Approving vault to spend tokens...");
      const atx = await token.approve(vaultAddr, amount*5n);
      console.log("  approve tx:", atx.hash);
      await atx.wait();
    }

    // Submit deposit
    console.log("\n📤 Calling PaymasterVault.deposit()...");
    const dtx = await vault.deposit(tokenAddr, amount, recipient);
    console.log("Transaction hash:", dtx.hash);
    console.log("Waiting for confirmation...");
    const receipt = await dtx.wait();
    if (!receipt) throw new Error("No receipt returned");

    console.log("✅ Deposit confirmed");
    console.log("Block number:", receipt.blockNumber);

    // Parse events to extract info
    const paymentInitiatedTopic = ethers.id("PaymentInitiated(address,address,address,uint256,bytes32)");
    const tokenDepositedTopic = ethers.id("TokenDeposited(uint256,address,address,uint256,address,uint256)");

    let depositId: string | undefined;
    let paymentLogIndex: number | undefined;
    let txIndex: number | undefined = (receipt as any).index;

    for (let i = 0; i < receipt.logs.length; i++) {
      const log = receipt.logs[i];
      if (log.address.toLowerCase() !== vaultAddr.toLowerCase()) continue;
      if (log.topics && log.topics.length > 0) {
        if (log.topics[0].toLowerCase() === tokenDepositedTopic.toLowerCase()) {
          // TokenDeposited(depositId, depositor, token, amount, recipient, blockNumber)
          try {
            const parsed = vault.interface.parseLog(log);
            depositId = (parsed!.args[0] as bigint).toString();
          } catch {}
        } else if (log.topics[0].toLowerCase() === paymentInitiatedTopic.toLowerCase()) {
          paymentLogIndex = i;
        }
      }
    }

    // Compute canonical paymentId for reference if we have indices
    let paymentId: string | undefined;
    try {
      if (paymentLogIndex !== undefined && txIndex !== undefined) {
        const network = await ethers.provider.getNetwork();
        paymentId = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256","address","uint256","uint256","uint256"],
            [network.chainId, vaultAddr, receipt.blockNumber, txIndex, paymentLogIndex]
          )
        );
      }
    } catch {}

    console.log("\n🔗 ROFL Processing Info:");
    console.log("  Network:", hre.network.name);
    console.log("  Chain ID:", (await ethers.provider.getNetwork()).chainId.toString());
    console.log("  Transaction Hash:", dtx.hash);
    console.log("  Block Number:", receipt.blockNumber);
    if (typeof txIndex === "number") console.log("  Tx Index:", txIndex);
    if (typeof paymentLogIndex === "number") console.log("  PaymentInitiated Log Index:", paymentLogIndex);
    if (depositId) console.log("  Deposit ID:", depositId);
    if (paymentId) console.log("  Canonical Payment ID:", paymentId);

    return {
      depositId,
      transactionHash: dtx.hash,
      blockNumber: receipt.blockNumber,
      transactionIndex: txIndex,
      paymentLogIndex,
      paymentId,
    };
  });
