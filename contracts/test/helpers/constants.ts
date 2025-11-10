import { parseEther, parseUnits } from "ethers";

/**
 * Test constants for CrossChainPaymaster tests
 */

// Price feed decimals (standard Chainlink configurations)
export const DECIMALS_8 = 8;
export const DECIMALS_18 = 18;
export const DECIMALS_6 = 6;
export const NORMALIZED_DECIMALS = 18;

// Sample prices (in their respective decimals)
export const USD_PRICE_8_DECIMALS = parseUnits("1", 8); // $1.00
export const ROSE_PRICE_8_DECIMALS = parseUnits("5", 8); // $5.00
export const ROSE_PRICE_18_DECIMALS = parseUnits("0.05", 18); // $0.05

// Token amounts
export const ONE_TOKEN = parseEther("1"); // 1 token with 18 decimals
export const TEN_TOKENS = parseEther("10"); // 10 tokens with 18 decimals
export const HUNDRED_TOKENS = parseEther("100"); // 100 tokens with 18 decimals

// Time constants
export const ONE_HOUR = 3600;
export const ONE_DAY = 86400;
export const STALENESS_THRESHOLD = ONE_HOUR; // 1 hour staleness threshold

// Chain IDs
export const ETHEREUM_CHAIN_ID = 1n;
export const POLYGON_CHAIN_ID = 137n;
export const SAPPHIRE_CHAIN_ID = 23294n;

// Distribution limits
export const DAILY_LIMIT = parseEther("1000"); // 1000 ROSE daily limit
export const PER_TX_LIMIT = parseEther("100"); // 100 ROSE per transaction limit

// Zero address
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
