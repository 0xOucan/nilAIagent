import { z } from "zod";
import { CONTRACT_TYPES } from "./constants";

export const DeployContractSchema = z
  .object({
    contractType: z.enum(Object.keys(CONTRACT_TYPES) as [string, ...string[]]),
    shardId: z.number().min(1).default(1),
    constructorArgs: z.array(z.unknown()).optional(),
    salt: z.number().optional(),
    useInternalDeployment: z.boolean().default(false)
  })
  .strip();