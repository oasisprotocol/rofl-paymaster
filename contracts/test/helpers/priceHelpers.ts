import { NORMALIZED_DECIMALS } from "./constants";

/**
 * Helper functions for price calculations in tests
 */

/**
 * Normalizes a price to 18 decimals
 * @param price The price value
 * @param decimals The current decimals of the price
 * @returns The price normalized to 18 decimals
 */
export function normalizePrice(price: bigint, decimals: number): bigint {
  if (decimals < NORMALIZED_DECIMALS) {
    // Scale up: price * 10^(18 - decimals)
    return price * 10n ** BigInt(NORMALIZED_DECIMALS - decimals);
  } else if (decimals > NORMALIZED_DECIMALS) {
    // Scale down: price / 10^(decimals - 18)
    return price / 10n ** BigInt(decimals - NORMALIZED_DECIMALS);
  }
  return price;
}

/**
 * Calculates the median of an array of bigints
 * @param values Array of values
 * @returns The median value
 */
export function calculateMedian(values: bigint[]): bigint {
  if (values.length === 0) throw new Error("Empty array");

  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  if (sorted.length % 2 === 1) {
    // Odd number: return middle element
    return sorted[Math.floor(sorted.length / 2)];
  } else {
    // Even number: return average of two middle elements
    const mid1 = sorted[sorted.length / 2 - 1];
    const mid2 = sorted[sorted.length / 2];
    return (mid1 + mid2) / 2n;
  }
}

/**
 * Calculates the mean (average) of two values
 * @param a First value
 * @param b Second value
 * @returns The average value
 */
export function calculateMean(a: bigint, b: bigint): bigint {
  return (a + b) / 2n;
}

/**
 * Calculates expected ROSE amount from token conversion
 * @param tokenAmount Amount of tokens
 * @param tokenPrice Price of token in USD (with tokenPriceDecimals)
 * @param tokenPriceDecimals Decimals of token price feed
 * @param rosePrice Price of ROSE in USD (normalized to 18 decimals)
 * @param tokenDecimals Decimals of the token itself
 * @returns Expected ROSE amount (with 18 decimals)
 */
export function calculateExpectedRoseAmount(
  tokenAmount: bigint,
  tokenPrice: bigint,
  tokenPriceDecimals: number,
  rosePrice: bigint,
  tokenDecimals: number
): bigint {
  // Implementation matches the contract logic:
  // roseAmount = tokenAmount * (tokenUsd / roseUsd) adjusted to 18 decimals
  // = tokenAmount * tPrice * 10^18 * 10^18 / (10^tokenDec * 10^tDec * avgRosePrice)

  // Step 1: num = tokenAmount * tPrice / 10^tokenDec
  const num1 = (tokenAmount * tokenPrice) / 10n ** BigInt(tokenDecimals);

  // Step 2: num = num * 10^18 / 10^tDec
  const num2 = (num1 * 10n ** BigInt(NORMALIZED_DECIMALS)) / 10n ** BigInt(tokenPriceDecimals);

  // Step 3: roseAmount = num * 10^18 / avgRosePrice
  const roseAmount = (num2 * 10n ** 18n) / rosePrice;

  return roseAmount;
}

/**
 * Converts a number with specific decimals to wei (18 decimals)
 * @param amount The amount
 * @param decimals The current decimals
 * @returns Amount in 18 decimals
 */
export function toWei(amount: bigint, decimals: number): bigint {
  if (decimals === 18) return amount;
  if (decimals < 18) {
    return amount * 10n ** BigInt(18 - decimals);
  }
  return amount / 10n ** BigInt(decimals - 18);
}

/**
 * Formats a price with its decimals for display
 * @param price The price value
 * @param decimals The decimals
 * @returns Formatted string
 */
export function formatPrice(price: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const wholePart = price / divisor;
  const fractionalPart = price % divisor;
  return `${wholePart}.${fractionalPart.toString().padStart(decimals, "0")}`;
}
