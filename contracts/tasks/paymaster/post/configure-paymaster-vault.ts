import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

function toBool(v?: string | boolean): boolean {
  if (typeof v === "boolean") return v;
  if (!v) return false;
  const s = v.toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

task("configure:paymaster-vault", "Post-deploy configuration for PaymasterVault")
  .addOptionalParam("proxy", "Deployed PaymasterVault proxy address (or set env PAYMASTER_VAULT_PROXY)")
  .addOptionalParam("token", "ERC20 token address to configure (or set env PAYMASTER_VAULT_TOKEN)")
  .addOptionalParam("enabled", "Enable/disable deposits for token (default: true)")
  .addOptionalParam("decimals", "Token decimals (0-18; required if setting min/max)")
  .addOptionalParam("min", "Minimum deposit amount (whole tokens, parsed with 'decimals')")
  .addOptionalParam("max", "Maximum deposit amount (whole tokens, parsed with 'decimals')")
  .addOptionalParam("dailylimit", "Per-token daily limit (whole tokens, parsed with 'decimals')")
  .addOptionalParam("breakerenabled", "Enable per-token circuit breaker (default: true)")
  .setAction(async (args: any, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;

    // Resolve inputs with env fallbacks
    const proxy: string = args.proxy ?? process.env.PAYMASTER_VAULT_PROXY as string;
    if (!proxy) throw new Error("Missing proxy: pass --proxy or set PAYMASTER_VAULT_PROXY env");

    const token: string | undefined = args.token ?? process.env.PAYMASTER_VAULT_TOKEN;
    const enabled: boolean = args.enabled !== undefined
      ? toBool(args.enabled)
      : (process.env.PAYMASTER_VAULT_TOKEN_ENABLED !== undefined ? toBool(process.env.PAYMASTER_VAULT_TOKEN_ENABLED) : true);
    const decimals: number | undefined = args.decimals
      ? parseInt(args.decimals)
      : (process.env.PAYMASTER_VAULT_TOKEN_DECIMALS ? parseInt(process.env.PAYMASTER_VAULT_TOKEN_DECIMALS) : undefined);
    const minStr: string | undefined = args.min ?? process.env.PAYMASTER_VAULT_TOKEN_MIN;
    const maxStr: string | undefined = args.max ?? process.env.PAYMASTER_VAULT_TOKEN_MAX;
    const dailyStr: string | undefined = args.dailylimit ?? process.env.PAYMASTER_VAULT_TOKEN_DAILY_LIMIT;
    const breakerEnabled: boolean = args.breakerenabled !== undefined
      ? toBool(args.breakerenabled)
      : (process.env.PAYMASTER_VAULT_BREAKER_ENABLED !== undefined ? toBool(process.env.PAYMASTER_VAULT_BREAKER_ENABLED) : true);

    const vault = await ethers.getContractAt("PaymasterVault", proxy);

    console.log("Network:", hre.network.name);
    console.log("Proxy:", proxy);

    // 1) Configure token asset if provided
    if (token) {
      if (decimals === undefined) {
        throw new Error("--decimals is required when configuring token min/max amounts");
      }
      if (decimals < 0 || decimals > 18) throw new Error("decimals must be between 0 and 18");

      const minAmount = minStr ? ethers.parseUnits(minStr, decimals) : 0n;
      const maxAmount = maxStr ? ethers.parseUnits(maxStr, decimals) : 0n;

      const cfg = {
        enabled,
        decimals,
        minAmount,
        maxAmount,
      };
      console.log("Setting token config:", token, cfg);
      const tx = await vault.setTokenConfig(token, cfg);
      console.log("tx:", tx.hash);
      await tx.wait();

      // 2) Circuit breaker settings for token
      if (dailyStr) {
        const daily = ethers.parseUnits(dailyStr, decimals);
        console.log("Setting per-token daily limit:", daily.toString());
        const ltx = await vault.setTokenDailyLimit(token, daily);
        console.log("tx:", ltx.hash);
        await ltx.wait();
      }
      if (args.breakerenabled !== undefined) {
        console.log("Setting per-token circuit breaker enabled:", breakerEnabled);
        const etx = await vault.setTokenCircuitBreakerEnabled(token, breakerEnabled);
        console.log("tx:", etx.hash);
        await etx.wait();
      }
    }

    console.log("✅ PaymasterVault configuration completed");
  });
