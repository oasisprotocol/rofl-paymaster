import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

task("transfer:ownership", "Transfer ownership of PaymasterVault or CrossChainPaymaster")
  .addParam("proxy", "Deployed proxy address")
  .addParam("newowner", "New owner address")
  .addOptionalParam("contract", "Contract name: 'vault' or 'paymaster' (default: auto-detect)")
  .setAction(async (args: { proxy: string; newowner: string; contract?: string }, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;

    const proxy = args.proxy;
    const newOwner = args.newowner;

    if (!ethers.isAddress(proxy)) {
      throw new Error(`Invalid proxy address: ${proxy}`);
    }
    if (!ethers.isAddress(newOwner)) {
      throw new Error(`Invalid new owner address: ${newOwner}`);
    }

    console.log("Network:", hre.network.name);
    console.log("Proxy:", proxy);
    console.log("New Owner:", newOwner);

    // Determine contract type
    let contractName: string;
    if (args.contract === "vault") {
      contractName = "PaymasterVault";
    } else if (args.contract === "paymaster") {
      contractName = "CrossChainPaymaster";
    } else {
      // Auto-detect by trying to call a unique function
      const vaultInterface = new ethers.Interface(["function tokenConfigs(address) view returns (bool,uint8,uint256,uint256)"]);
      const code = await ethers.provider.getCode(proxy);
      if (code === "0x") {
        throw new Error("No contract at proxy address");
      }

      // Try vault-specific call
      try {
        const vault = new ethers.Contract(proxy, vaultInterface, ethers.provider);
        await vault.tokenConfigs(ethers.ZeroAddress);
        contractName = "PaymasterVault";
      } catch {
        contractName = "CrossChainPaymaster";
      }
    }

    console.log("Contract type:", contractName);

    const contract = await ethers.getContractAt(contractName, proxy);

    // Check current owner
    const currentOwner = await contract.owner();
    console.log("Current owner:", currentOwner);

    if (currentOwner.toLowerCase() === newOwner.toLowerCase()) {
      console.log("⚠️  New owner is already the current owner. Nothing to do.");
      return;
    }

    const [signer] = await ethers.getSigners();
    if (currentOwner.toLowerCase() !== signer.address.toLowerCase()) {
      throw new Error(`Signer ${signer.address} is not the current owner ${currentOwner}`);
    }

    console.log("Transferring ownership...");
    const tx = await contract.transferOwnership(newOwner);
    console.log("tx:", tx.hash);
    await tx.wait();

    // Verify
    const updatedOwner = await contract.owner();
    console.log("✅ Ownership transferred. New owner:", updatedOwner);
  });
