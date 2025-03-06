import { z } from "zod";
import { CONTRACT_TYPES } from "./constants";

// Add compiler versions and EVM versions
const CompilerVersion = z.enum(["0.8.20", "0.8.24", "0.8.28"]);
const EVMVersion = z.enum(["paris", "shanghai", "cancun"]);

export const DeployContractSchema = z
  .object({
    contractType: z
      .string()
      .describe("The type of contract to deploy (e.g., COUNTER, TOKEN, NFT)"),
    shardId: z
      .number()
      .default(1)
      .describe("The shard ID where the contract will be deployed (defaults to 1)"),
    constructorArgs: z
      .array(z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .describe("Optional constructor arguments for the contract"),
    salt: z
      .number()
      .optional()
      .describe("Optional salt value to customize the contract address"),
    useInternalDeployment: z
      .boolean()
      .default(false)
      .describe("Whether to use internal deployment method (default is external)"),
    initialValue: z
      .number()
      .optional()
      .describe("Optional initial value for counter contracts"),
    maxValue: z
      .number()
      .optional()
      .describe("Optional maximum value for advanced counter contracts"),
    // Token-specific parameters
    tokenName: z
      .string()
      .optional()
      .describe("Optional name for token contracts"),
    tokenSymbol: z
      .string()
      .optional()
      .describe("Optional symbol for token contracts"),
    tokenDecimals: z
      .number()
      .optional()
      .describe("Optional decimals for token contracts (default is 18)"),
    tokenSupply: z
      .string()
      .optional()
      .describe("Optional initial supply for token contracts"),
    // NFT-specific parameters
    nftName: z
      .string()
      .optional()
      .describe("Optional name for NFT contracts"),
    nftSymbol: z
      .string()
      .optional()
      .describe("Optional symbol for NFT contracts"),
    nftBaseUri: z
      .string()
      .optional()
      .describe("Optional base URI for NFT metadata"),
  })
  .strip();

// Schema for compiling a contract with Cometa
export const CompileContractSchema = z.object({
  contractName: z
    .string()
    .describe("The name of the contract, including file prefix (e.g. 'Counter.sol:Counter')"),
  sourceCode: z
    .string()
    .describe("The Solidity source code to compile"),
  compilerVersion: CompilerVersion
    .default("0.8.28")
    .describe("The Solidity compiler version to use"),
  evmVersion: EVMVersion
    .default("shanghai")
    .describe("The EVM version to target"),
  optimizerEnabled: z
    .boolean()
    .default(false)
    .describe("Whether to enable the optimizer"),
  optimizerRuns: z
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(200)
    .describe("Number of optimizer runs if optimizer is enabled"),
  shardId: z
    .number()
    .default(1)
    .describe("The shard ID where the contract will be deployed"),
  autoDeployContract: z
    .boolean()
    .default(true)
    .describe("Whether to automatically deploy the contract after compilation"),
  constructorArgs: z
    .array(z.union([z.string(), z.number(), z.boolean()]))
    .default([])
    .describe("Constructor arguments for the contract"),
});

// Schema for registering a deployed contract with Cometa
export const RegisterContractSchema = z.object({
  address: z
    .string()
    .describe("The address of the deployed contract to register"),
  contractName: z
    .string()
    .describe("The name of the contract, including file prefix (e.g. 'Counter.sol:Counter')"),
  sourceCode: z
    .string()
    .describe("The Solidity source code of the contract"),
  compilerVersion: CompilerVersion
    .default("0.8.28")
    .describe("The Solidity compiler version used"),
  evmVersion: EVMVersion
    .default("shanghai")
    .describe("The EVM version targeted"),
  optimizerEnabled: z
    .boolean()
    .default(false)
    .describe("Whether the optimizer was enabled"),
  optimizerRuns: z
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(200)
    .describe("Number of optimizer runs if optimizer was enabled"),
  shardId: z
    .number()
    .default(1)
    .describe("The shard ID where the contract is deployed"),
});