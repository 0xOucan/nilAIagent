import { z } from "zod";
import { SUPPORTED_TOKENS } from "./constants";

export const CreateSmartAccountSchema = z.object({
  shardId: z
    .number()
    .refine(id => [0, 1, 2, 3, 4].includes(id), {
      message: "Shard ID must be between 0 and 4"
    })
    .default(1)
    .describe("The shard ID where the account will be created (0-4, defaults to 1)"),
  privateKey: z
    .string()
    .optional()
    .describe("Optional private key for account recovery (auto-generated if not provided)")
}).strip();

export const TopUpAccountSchema = z
  .object({
    tokens: z.array(z.enum(Object.keys(SUPPORTED_TOKENS) as [string, ...string[]]))
      .describe("Array of tokens to top up with their minimum amounts"),
    address: z.string().optional()
      .describe("Optional address of existing account to top up"),
  })
  .strip();

export const CheckBalanceSchema = z.object({
  address: z
    .string()
    .describe("The NIL address to check the balance for (with or without 0x prefix)"),
  shardId: z
    .number()
    .default(1)
    .describe("The shard ID where the address is located (defaults to 1)"),
});

export const MintTokenSchema = z.object({
  address: z
    .string()
    .optional()
    .describe("Address of the smart account to mint tokens for. If omitted, a new account will be created."),
  
  amount: z
    .string()
    .describe("Amount of tokens to mint (exact number with no decimals, e.g. 50_000_000)"),
  
  tokenName: z
    .string()
    .optional()
    .describe("Custom name for the token (e.g. MY_TOKEN)"),
  
  shardId: z
    .number()
    .min(1)
    .max(4)
    .optional()
    .default(1)
    .describe("Shard ID for the operation (1-4)"),
});

export const TransferTokenSchema = z.object({
  fromAddress: z
    .string()
    .describe("The smart account address that will send tokens"),
  toAddress: z
    .string()
    .describe("The destination address to receive tokens"),
  amount: z
    .string()
    .describe("Amount of tokens to transfer (as a string number)"),
  tokenId: z
    .string()
    .optional()
    .describe("Optional token ID for custom tokens (defaults to native token)"),
  targetShardId: z
    .number()
    .optional()
    .describe("Optional target shard ID for cross-shard transfers")
});

export const BurnTokenSchema = z.object({
  address: z
    .string()
    .describe("The smart account address that will burn tokens"),
  amount: z
    .string()
    .describe("Amount of tokens to burn (as a string number)"),
});

// Define recipient structure for batch transfers
export const BatchTokenRecipient = z.object({
  address: z
    .string()
    .describe("The destination address to receive tokens"),
  amount: z
    .string()
    .describe("Amount of tokens to transfer to this recipient (as a string number)"),
});

// Schema for batch token transfers
export const BatchTransferTokensSchema = z.object({
  fromAddress: z
    .string()
    .describe("The smart account address that will send tokens"),
  recipients: z
    .array(BatchTokenRecipient)
    .min(1)
    .max(50)
    .describe("Array of recipients with their addresses and amounts"),
  tokenId: z
    .string()
    .optional()
    .describe("Optional token ID for custom tokens (defaults to native token)"),
  shardId: z
    .number()
    .optional()
    .describe("Optional shard ID where the account is located"),
  crossShardEnabled: z
    .boolean()
    .default(false)
    .describe("Whether to allow transfers across different shards"),
});