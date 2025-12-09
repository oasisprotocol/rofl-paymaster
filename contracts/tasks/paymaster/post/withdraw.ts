import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

function requireAddress(name: string, val?: string): string {
  if (!val || !/^0x[a-fA-F0-9]{40}$/.test(val)) {
    throw new Error(`Missing or invalid ${name}: got ${val ?? "<undefined>"}`);
  }
  return val;
}

// Withdraw ROSE from CrossChainPaymaster (Sapphire)
// Usage: bunx hardhat paymaster:withdraw-rose --proxy 0x... --to 0x... --amount 100 --network sapphire-testnet
task("paymaster:withdraw-rose", "Withdraw ROSE from CrossChainPaymaster")
  .addOptionalParam("proxy", "CrossChainPaymaster proxy address (env PAYMASTER_SAPPHIRE_PROXY)")
  .addOptionalParam("to", "Recipient address (env WITHDRAW_TO, defaults to signer)")
  .addParam("amount", "Amount of ROSE to withdraw (e.g., '100.5')")
  .setAction(async (args: { proxy?: string; to?: string; amount: string }, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;
    const proxy = requireAddress("proxy", args.proxy ?? process.env.PAYMASTER_SAPPHIRE_PROXY);

    const [signer] = await ethers.getSigners();
    const to = args.to ?? process.env.WITHDRAW_TO ?? signer.address;
    requireAddress("to", to);

    const amount = ethers.parseEther(args.amount);
    if (amount <= 0n) throw new Error("Amount must be greater than 0");

    const paymaster = await ethers.getContractAt("CrossChainPaymaster", proxy);

    // Display current balance
    const currentBalance = await ethers.provider.getBalance(proxy);
    console.log("Paymaster contract address:", proxy);
    console.log("Contract ROSE balance:", ethers.formatEther(currentBalance), "ROSE");
    console.log("Withdraw amount:      ", ethers.formatEther(amount), "ROSE");
    console.log("Recipient:            ", to);

    if (amount > currentBalance) {
      throw new Error(`Insufficient balance: ${ethers.formatEther(currentBalance)} ROSE available, ${ethers.formatEther(amount)} ROSE requested`);
    }

    console.log("Withdrawing ROSE...");
    const tx = await paymaster.withdrawRose(to, amount);
    console.log("tx:", tx.hash);
    await tx.wait();

    // Display new balance
    const newBalance = await ethers.provider.getBalance(proxy);
    console.log("New contract balance: ", ethers.formatEther(newBalance), "ROSE");
    console.log("✅ ROSE withdrawal complete");
  });

// Withdraw ERC20 tokens from PaymasterVault (remote chains)
// Usage: bunx hardhat vault:withdraw-token --proxy 0x... --token 0x... --to 0x... --amount 1000 --decimals 6 --network base-sepolia
task("vault:withdraw-token", "Withdraw ERC20 tokens from PaymasterVault")
  .addOptionalParam("proxy", "PaymasterVault proxy address (env PAYMASTER_VAULT_PROXY)")
  .addOptionalParam("token", "ERC20 token address (env PAYMASTER_VAULT_TOKEN)")
  .addOptionalParam("to", "Recipient address (env WITHDRAW_TO, defaults to signer)")
  .addParam("amount", "Amount to withdraw in whole tokens (e.g., '1000')")
  .addOptionalParam("decimals", "Token decimals (env PAYMASTER_VAULT_TOKEN_DECIMALS, default: 6)")
  .setAction(async (args: { proxy?: string; token?: string; to?: string; amount: string; decimals?: string }, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;
    const proxy = requireAddress("proxy", args.proxy ?? process.env.PAYMASTER_VAULT_PROXY);
    const token = requireAddress("token", args.token ?? process.env.PAYMASTER_VAULT_TOKEN);

    const [signer] = await ethers.getSigners();
    const to = args.to ?? process.env.WITHDRAW_TO ?? signer.address;
    requireAddress("to", to);

    const decStr = args.decimals ?? process.env.PAYMASTER_VAULT_TOKEN_DECIMALS ?? "6";
    const decimals = parseInt(decStr, 10);
    if (Number.isNaN(decimals) || decimals < 0 || decimals > 18) throw new Error("Invalid decimals (0-18)");

    const amount = ethers.parseUnits(args.amount, decimals);
    if (amount <= 0n) throw new Error("Amount must be greater than 0");

    const vault = await ethers.getContractAt("PaymasterVault", proxy);
    const erc20 = await ethers.getContractAt("IERC20", token);

    // Display current balance
    const currentBalance = await erc20.balanceOf(proxy);
    console.log("Vault token balance:", ethers.formatUnits(currentBalance, decimals), `(${decimals} decimals)`);
    console.log("Withdraw amount:    ", ethers.formatUnits(amount, decimals));
    console.log("Token address:      ", token);
    console.log("Recipient:          ", to);

    if (amount > currentBalance) {
      throw new Error(`Insufficient balance: ${ethers.formatUnits(currentBalance, decimals)} available, ${ethers.formatUnits(amount, decimals)} requested`);
    }

    console.log("Withdrawing tokens...");
    const tx = await vault.withdrawToken(token, to, amount);
    console.log("tx:", tx.hash);
    await tx.wait();

    // Display new balance
    const newBalance = await erc20.balanceOf(proxy);
    console.log("New vault balance:  ", ethers.formatUnits(newBalance, decimals));
    console.log("✅ Token withdrawal complete");
  });
