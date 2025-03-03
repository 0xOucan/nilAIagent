import { z } from "zod";
import { SUPPORTED_TOKENS } from "./constants";

export const CreateSmartAccountSchema = z.object({
  shardId: z
    .number()
    .default(1)
    .describe("The shard ID where the smart account will be created (defaults to 1)"),
  salt: z
    .string()
    .optional()
    .describe("Optional salt value to customize the account address"),
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
    .describe("The smart account address that will mint tokens"),
  tokenName: z
    .string()
    .optional()
    .describe("Optional name for the new token"),
  amount: z
    .string()
    .describe("Amount of tokens to mint (as a string number)"),
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
});

export const BurnTokenSchema = z.object({
  address: z
    .string()
    .describe("The smart account address that will burn tokens"),
  amount: z
    .string()
    .describe("Amount of tokens to burn (as a string number)"),
});