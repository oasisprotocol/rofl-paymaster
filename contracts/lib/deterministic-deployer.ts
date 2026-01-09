/**
 * Deterministic deployment via CreateX CREATE3 with OpenZeppelin upgrade validation.
 */

import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  assertUpgradeSafe,
  getStorageLayout,
  getUnlinkedBytecode,
  getVersion,
  Manifest,
  ProxyDeployment,
  ImplDeployment,
  ValidationDataCurrent,
  StorageLayout,
} from "@openzeppelin/upgrades-core";

export const CREATEX_ADDRESS = "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed";

const CREATEX_ABI = [
  "function deployCreate3(bytes32 salt, bytes calldata initCode) external payable returns (address)",
  "event ContractCreation(address indexed newContract)",
];

const ERC1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export interface DeploymentResult {
  proxy: string;
  implementation: string;
  proxyTx: ethers.TransactionResponse;
  implTx: ethers.TransactionResponse;
}

export interface DeploymentInfo {
  deployer: string;
  salts: { proxy: string; implementation: string };
}

export interface DeployOptions {
  force?: boolean;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

/**
 * Compute deterministic salts with CreateX cross-chain format.
 * Salt format: 0x00 (MsgSender) + 0x01 (no chainId) + 30 bytes entropy
 */
export function computeSalts(baseSalt: string): { proxy: string; implementation: string } {
  const implHash = ethers.keccak256(ethers.toUtf8Bytes(`${baseSalt}:impl`));
  const proxyHash = ethers.keccak256(ethers.toUtf8Bytes(`${baseSalt}:proxy`));
  return {
    implementation: ethers.concat(["0x0001", implHash.slice(0, 62)]),
    proxy: ethers.concat(["0x0001", proxyHash.slice(0, 62)]),
  };
}

export async function getCreateX(
  signer: ethers.Signer,
  provider: ethers.Provider
): Promise<ethers.Contract> {
  const code = await provider.getCode(CREATEX_ADDRESS);
  if (code === "0x") {
    throw new Error(`CreateX not deployed. See https://github.com/pcaversaccio/createx`);
  }
  return new ethers.Contract(CREATEX_ADDRESS, CREATEX_ABI, signer);
}

function parseContractCreation(
  receipt: ethers.TransactionReceipt,
  iface: ethers.Interface
): string {
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "ContractCreation") {
        return parsed.args.newContract;
      }
    } catch {
      // Not our event
    }
  }
  throw new Error("ContractCreation event not found");
}

async function waitForCode(provider: ethers.Provider, address: string): Promise<string> {
  let code = await provider.getCode(address);
  if (code === "0x" || code.length < 10) {
    await new Promise((r) => setTimeout(r, 3000));
    code = await provider.getCode(address);
  }
  if (code === "0x" || code.length < 10) {
    throw new Error(`No code at ${address}`);
  }
  return code;
}

export async function getDeploymentInfo(
  signer: ethers.Signer,
  baseSalt: string
): Promise<DeploymentInfo> {
  return { deployer: await signer.getAddress(), salts: computeSalts(baseSalt) };
}

export async function isSaltUsed(signer: ethers.Signer, salt: string): Promise<boolean> {
  const provider = signer.provider;
  if (!provider) throw new Error("Signer must have a provider");

  const createX = await getCreateX(signer, provider);
  try {
    await createX.deployCreate3.estimateGas(salt, "0x6001600c60003960016000f300");
    return false;
  } catch {
    return true;
  }
}

export async function deployUUPSProxy(
  hre: HardhatRuntimeEnvironment,
  signer: ethers.Signer,
  contractName: string,
  baseSalt: string,
  initArgs: unknown[],
  options: DeployOptions = {}
): Promise<DeploymentResult> {
  const provider = signer.provider;
  if (!provider) throw new Error("Signer must have a provider");

  const createX = await getCreateX(signer, provider);
  const salts = computeSalts(baseSalt);

  if (!options.force) {
    const [implUsed, proxyUsed] = await Promise.all([
      isSaltUsed(signer, salts.implementation),
      isSaltUsed(signer, salts.proxy),
    ]);
    if (implUsed || proxyUsed) {
      throw new Error(`Salt "${baseSalt}" already used. Use a different salt.`);
    }
  }

  const { readValidations } = await import("@openzeppelin/hardhat-upgrades/dist/utils/validations");
  const validations: ValidationDataCurrent = await readValidations(hre);

  const Factory = await hre.ethers.getContractFactory(contractName, signer);
  const unlinkedBytecode = getUnlinkedBytecode(validations, Factory.bytecode);
  const encodedArgs = Factory.interface.encodeDeploy([]);
  const version = getVersion(unlinkedBytecode, Factory.bytecode, encodedArgs);
  const layout = getStorageLayout(validations, version);

  assertUpgradeSafe(validations, version, { kind: "uups", unsafeAllow: [] });

  const txOverrides: Record<string, unknown> = {};
  if (options.gasPrice) txOverrides.gasPrice = options.gasPrice;
  if (options.maxFeePerGas) txOverrides.maxFeePerGas = options.maxFeePerGas;
  if (options.maxPriorityFeePerGas) txOverrides.maxPriorityFeePerGas = options.maxPriorityFeePerGas;

  // Deploy implementation
  console.log(`\nDeploying implementation...`);
  const implInitCode = ethers.concat([Factory.bytecode, encodedArgs]);
  const implTx = await createX.deployCreate3(salts.implementation, implInitCode, txOverrides);
  const implReceipt = await implTx.wait();
  const implAddress = parseContractCreation(implReceipt!, createX.interface);
  await waitForCode(provider, implAddress);
  console.log(`  ✓ Implementation: ${implAddress}`);
  console.log(`  Tx: ${implTx.hash}`);

  // Deploy proxy
  console.log(`\nDeploying proxy...`);
  const proxyArtifact = JSON.parse(
    fs.readFileSync(
      path.join(hre.config.paths.root, "node_modules/@openzeppelin/contracts/build/contracts/ERC1967Proxy.json"),
      "utf-8"
    )
  );
  const initData = Factory.interface.encodeFunctionData("initialize", initArgs);
  const proxyArgs = ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes"], [implAddress, initData]);
  const proxyInitCode = ethers.concat([proxyArtifact.bytecode, proxyArgs]);

  const proxyTx = await createX.deployCreate3(salts.proxy, proxyInitCode, txOverrides);
  const proxyReceipt = await proxyTx.wait();
  const proxyAddress = parseContractCreation(proxyReceipt!, createX.interface);
  await waitForCode(provider, proxyAddress);

  // Verify proxy points to implementation
  const storedImpl = await provider.getStorage(proxyAddress, ERC1967_IMPL_SLOT);
  const storedImplAddr = "0x" + storedImpl.slice(-40);
  if (storedImplAddr.toLowerCase() !== implAddress.toLowerCase()) {
    throw new Error(`Proxy impl mismatch: expected ${implAddress}, got ${storedImplAddr}`);
  }

  console.log(`  ✓ Proxy: ${proxyAddress}`);
  console.log(`  Tx: ${proxyTx.hash}`);

  await updateManifest(hre, proxyAddress, implAddress, contractName, layout, validations);
  console.log(`\n✅ ${contractName} deployed successfully!`);

  return { proxy: proxyAddress, implementation: implAddress, proxyTx, implTx };
}

async function updateManifest(
  hre: HardhatRuntimeEnvironment,
  proxyAddress: string,
  implAddress: string,
  contractName: string,
  layout: StorageLayout,
  validations: ValidationDataCurrent
): Promise<void> {
  const manifest = await Manifest.forNetwork(hre.network.provider);
  await manifest.addProxy({ address: proxyAddress, kind: "uups" } as ProxyDeployment);

  await manifest.lockedRun(async () => {
    const data = await manifest.read();
    data.impls = data.impls || {};
    const Factory = await hre.ethers.getContractFactory(contractName);
    const unlinkedBytecode = getUnlinkedBytecode(validations, Factory.bytecode);
    const version = getVersion(unlinkedBytecode, Factory.bytecode, "0x");
    data.impls[version.linkedWithoutMetadata] = { address: implAddress, layout } as ImplDeployment;
    await manifest.write(data);
  });
}
