export const DEFAULT_SHARD_ID = 1;

export const SUPPORTED_TOKENS = {
  NIL: "0x0001111111111111111111111111111111111110",
  ETH: "0x0001111111111111111111111111111111111112",
  USDT: "0x0001111111111111111111111111111111111113",
  BTC: "0x0001111111111111111111111111111111111114"
} as const;

// Define minimum amounts for each token with proper decimals
export const TOKEN_MINIMUM_AMOUNTS = {
  NIL: "100000000000000", // 0.0001 NIL (18 decimals)
  BTC: "100000000", // 1.0 BTC (8 decimals)
  ETH: "1000000000000000000", // 1.0 ETH (18 decimals)
  USDT: "1000000" // 1.0 USDT (6 decimals)
} as const;

// Define token decimals for proper formatting
export const TOKEN_DECIMALS = {
  NIL: 18,
  BTC: 8,
  ETH: 18,
  USDT: 6
} as const;

export type SupportedToken = keyof typeof SUPPORTED_TOKENS;
export type TokenAddress = typeof SUPPORTED_TOKENS[SupportedToken];
export type TokenAmount = typeof TOKEN_MINIMUM_AMOUNTS[SupportedToken];