import { z } from "zod";
import { CONTRACT_TYPES } from "./constants";

// Schema for deploying linked contracts
export const DeployLinkedContractsSchema = z.object({
  retailerShardId: z
    .number()
    .default(1)
    .describe("The shard ID where the retailer contract will be deployed (defaults to 1)"),
  manufacturerShardId: z
    .number()
    .default(2)
    .describe("The shard ID where the manufacturer contract will be deployed (defaults to 2)"),
  retailerSalt: z
    .number()
    .optional()
    .describe("Optional salt value for retailer contract (random if not provided)"),
  manufacturerSalt: z
    .number()
    .optional()
    .describe("Optional salt value for manufacturer contract (random if not provided)"),
  pubkey: z
    .string()
    .optional()
    .describe("Optional public key for manufacturer contract (generated if not provided)")
});

// Schema for ordering products
export const OrderProductSchema = z.object({
  retailerAddress: z
    .string()
    .describe("The address of the deployed Retailer contract"),
  manufacturerAddress: z
    .string()
    .describe("The address of the deployed Manufacturer contract"),
  productName: z
    .string()
    .describe("The name of the product to order"),
  shardId: z
    .number()
    .default(1)
    .describe("The shard ID where the contracts are deployed (defaults to 1)"),
});

// Schema for getting products
export const GetProductsSchema = z.object({
  manufacturerAddress: z
    .string()
    .describe("The address of the deployed Manufacturer contract"),
  shardId: z
    .number()
    .default(1)
    .describe("The shard ID where the contract is deployed (defaults to 1)"),
});

export const DeployRetailerSchema = z.object({
  shardId: z
    .number()
    .default(1)
    .describe("The shard ID where the contract will be deployed (defaults to 1)"),
  salt: z
    .number()
    .optional()
    .describe("Optional salt value to customize the contract address"),
  useInternalDeployment: z
    .boolean()
    .default(false)
    .describe("Whether to use internal deployment method (default is external)"),
});

export const DeployManufacturerSchema = z.object({
  publicKey: z
    .string()
    .optional()
    .describe("Optional public key for signature verification"),
  retailerAddress: z
    .string()
    .describe("The address of the deployed Retailer contract"),
  shardId: z
    .number()
    .default(1)
    .describe("The shard ID where the contract will be deployed (defaults to 1)"),
  salt: z
    .number()
    .optional()
    .describe("Optional salt value to customize the contract address"),
  useInternalDeployment: z
    .boolean()
    .default(false)
    .describe("Whether to use internal deployment method (default is external)"),
});

export const DeploySupplyChainSchema = z.object({
  shardId: z
    .number()
    .default(1)
    .describe("The shard ID where both contracts will be deployed (defaults to 1)"),
  salt: z
    .number()
    .optional()
    .describe("Optional salt value to customize the contract addresses"),
  useInternalDeployment: z
    .boolean()
    .default(false)
    .describe("Whether to use internal deployment method (default is external)"),
}); 