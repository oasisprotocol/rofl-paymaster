import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

function requireAddress(name: string, val?: string): string {
  if (!val || !/^0x[a-fA-F0-9]{40}$/.test(val)) {
    throw new Error(`Missing or invalid ${name}: got ${val ?? "<undefined>"}`);
  }
  return val;
}

// Update the price in a Chainlink MockV3Aggregator
// Usage:
// bunx hardhat oracle:updateprice --network sapphire-testnet --price 1.25 --oracle 0x...
task("oracle:updateprice", "Update price in MockV3Aggregator (single feed)")
  .addOptionalParam("oracle", "Oracle contract address (defaults to env PRICE_ORACLE)")
  .addOptionalParam("price", "New price, human number (defaults 1)", "1")
  .setAction(async (args: { oracle?: string; price?: string }, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;
    const oracleAddr = requireAddress("oracle", args.oracle ?? process.env.PRICE_ORACLE);
    const oracle = await ethers.getContractAt("MockV3Aggregator", oracleAddr);
    const decimals = await oracle.decimals();
    const price = ethers.parseUnits(args.price ?? "1", decimals);

    console.log("Network:", hre.network.name);
    console.log("Oracle:", oracleAddr);
    console.log("New price (scaled):", price.toString());
    const tx = await oracle.updateAnswer(price);
    console.log("tx:", tx.hash);
    await tx.wait();
    console.log("✅ Price updated");
  });

// Get latest price
task("oracle:getprice", "Read latestRoundData from MockV3Aggregator")
  .addOptionalParam("oracle", "Oracle contract address (defaults to env PRICE_ORACLE)")
  .setAction(async (args: { oracle?: string }, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;
    const oracleAddr = requireAddress("oracle", args.oracle ?? process.env.PRICE_ORACLE);
    const oracle = await ethers.getContractAt("MockV3Aggregator", oracleAddr);
    const [roundId, answer, , updatedAt, answeredInRound] = await oracle.latestRoundData();
    const decimals = await oracle.decimals();
    console.log("Round:", roundId.toString());
    console.log("Price:", ethers.formatUnits(answer, decimals));
    console.log("Decimals:", decimals);
    console.log("Updated At:", new Date(Number(updatedAt) * 1000).toISOString());
    console.log("Answered In Round:", answeredInRound.toString());
  });
