import { z } from "zod";
import {
  ActionProvider,
  Network,
  CreateAction,
  EvmWalletProvider,
} from "@coinbase/agentkit";
import { 
  HttpTransport, 
  PublicClient, 
  topUp,
  externalDeploymentTransaction,
  bytesToHex,
  hexToBytes,
  type Hex,
  generateSmartAccount,
  waitTillCompleted
} from "@nilfoundation/niljs";
import "reflect-metadata";
import * as crypto from 'crypto';

import { DeployContractSchema } from "./schemas";
import { 
  DEFAULT_SHARD_ID,
  DEFAULT_GAS_MULTIPLIER,
  CONTRACT_TYPES,
  type ContractType
} from "./constants";
import { ContractDeploymentError } from "./errors";

export class NilContractActionProvider extends ActionProvider<EvmWalletProvider> {
  private rpcEndpoint: string;
  private faucetEndpoint: string;
  private clients: Map<number, PublicClient> = new Map();

  constructor() {
    super("nil-contract", []);
    
    if (!process.env.NIL_RPC_ENDPOINT || !process.env.NIL_FAUCET_ENDPOINT) {
      throw new Error("NIL_RPC_ENDPOINT and NIL_FAUCET_ENDPOINT must be set");
    }

    this.rpcEndpoint = process.env.NIL_RPC_ENDPOINT;
    this.faucetEndpoint = process.env.NIL_FAUCET_ENDPOINT;
  }

  private getClient(shardId: number): PublicClient {
    if (!this.clients.has(shardId)) {
      this.clients.set(
        shardId,
        new PublicClient({
          transport: new HttpTransport({
            endpoint: this.rpcEndpoint,
          }),
          shardId,
        })
      );
    }
    return this.clients.get(shardId)!;
  }

  private isEmptyCode(code: Uint8Array | string): boolean {
    if (code instanceof Uint8Array) {
      return code.length === 0;
    }
    return code === '0x' || code === '';
  }

  private convertToHex(bytecode: string): Hex {
    // Remove any whitespace and ensure 0x prefix
    const cleanBytecode = bytecode.trim();
    return (cleanBytecode.startsWith('0x') ? cleanBytecode : `0x${cleanBytecode}`) as Hex;
  }

  private formatExplorerLink(type: 'address' | 'tx', value: string): string {
    // Remove 0x prefix if present
    const cleanValue = value.startsWith('0x') ? value.slice(2) : value;
    return `https://explore.nil.foundation/${type}/${cleanValue}`;
  }
  
  // Generate a truly random salt to avoid address collisions
  private generateRandomSalt(): bigint {
    const randomBytes = crypto.randomBytes(8);
    return BigInt('0x' + randomBytes.toString('hex'));
  }
  
  // Check if contract already exists at address
  private async contractExists(client: PublicClient, address: string): Promise<boolean> {
    try {
      // Convert address to proper Hex format
      const hexAddress = address.startsWith('0x') 
        ? address as Hex 
        : `0x${address}` as Hex;
        
      const code = await client.getCode(hexAddress);
      return !this.isEmptyCode(code);
    } catch (error) {
      return false;
    }
  }

  // Calculate contract address by creating a deployment transaction
  private calculateContractAddress(
    shardId: number, 
    salt: bigint, 
    bytecode: Hex, 
    abi: any, 
    chainId: number
  ): string {
    // Create a deployment transaction to get the address without sending it
    const deployTx = externalDeploymentTransaction(
      {
        salt,
        shard: shardId,
        bytecode,
        abi,
        args: [],
        feeCredit: 1n, // Minimal fee since we won't send it
      },
      chainId,
    );
    
    // Extract the address from the transaction
    return bytesToHex(deployTx.to);
  }

  // Try to top up with multiple attempts with decreasing amounts
  private async tryTopUp(address: Hex, initialAmount: bigint, retries = 3): Promise<boolean> {
    let amount = initialAmount;
    
    for (let i = 0; i < retries; i++) {
      try {
        console.log(`Attempt ${i+1}: Top up ${address} with ${amount.toString()} units`);
        
        await topUp({
          address,
          faucetEndpoint: this.faucetEndpoint,
          rpcEndpoint: this.rpcEndpoint,
          amount
        });
        
        // Wait a bit for the top-up to process
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Successfully topped up
        return true;
      } catch (error) {
        console.error(`Top-up error (attempt ${i+1}):`, error);
        
        // Reduce the amount for next try - faucet might have limits
        amount = amount / 2n;
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    return false;
  }

  @CreateAction({
    name: "deploy-nil-contract",
    description: "Deploy a smart contract to the NIL blockchain",
    schema: DeployContractSchema,
  })
  async deployContract(
    _walletProvider: EvmWalletProvider,
    args: z.infer<typeof DeployContractSchema>
  ): Promise<string> {
    try {
      const client = this.getClient(args.shardId);
      const gasPrice = await client.getGasPrice(args.shardId);
      const chainId = await client.chainId();
      
      // Generate a truly random salt for unique address
      const salt = this.generateRandomSalt();
      console.log(`Using salt: ${salt.toString()}`);

      const contractConfig = CONTRACT_TYPES[args.contractType as ContractType];
      const bytecode = this.convertToHex(contractConfig.bytecode);
      
      // Use a more moderate fee to avoid faucet issues
      const feeCredit = DEFAULT_GAS_MULTIPLIER * gasPrice;

      // Default to external deployment which is more reliable
      if (args.useInternalDeployment) {
        try {
          // Internal deployment using smart account
          const smartAccount = await generateSmartAccount({
            shardId: args.shardId,
            rpcEndpoint: this.rpcEndpoint,
            faucetEndpoint: this.faucetEndpoint,
          });
          
          console.log(`Using smart account: ${smartAccount.address}`);

          // Try to top up with decreasing amounts if needed
          const topUpSuccess = await this.tryTopUp(
            smartAccount.address as Hex, 
            feeCredit
          );
          
          if (!topUpSuccess) {
            throw new Error("Failed to fund smart account after multiple attempts");
          }

          // Deploy the contract
          const { address, hash } = await smartAccount.deployContract({
            bytecode,
            abi: contractConfig.abi,
            args: args.constructorArgs || [],
            feeCredit,
            salt,
            shardId: args.shardId,
          });
          
          console.log(`Deployment result: Contract address: ${address}, Hash: ${hash}`);
          
          // Wait for deployment to be confirmed
          await new Promise(resolve => setTimeout(resolve, 5000));
          const receipts = await waitTillCompleted(client, hash);
          
          // Verify the deployment
          const code = await client.getCode(address as Hex);
          if (this.isEmptyCode(code)) {
            throw new Error('Contract deployment failed - no code at address');
          }

          return `Successfully deployed ${args.contractType} contract (internal)!\n\n` +
                 `- **Contract Address:** ${address}\n` +
                 `  ${this.formatExplorerLink('address', address)}\n\n` +
                 `- **Smart Account:** ${smartAccount.address}\n` +
                 `  ${this.formatExplorerLink('address', smartAccount.address)}\n\n` +
                 `- **Transaction Hash:** ${hash}\n` +
                 `  ${this.formatExplorerLink('tx', hash)}\n\n` +
                 `- **Shard ID:** ${args.shardId}`;
                 
        } catch (error) {
          console.error("Internal deployment failed, falling back to external deployment:", error);
          // Fall back to external deployment when internal fails
        }
      }
      
      // External deployment
      const deploymentTx = externalDeploymentTransaction(
        {
          salt,
          shard: args.shardId,
          bytecode,
          abi: contractConfig.abi,
          args: args.constructorArgs || [],
          feeCredit,
        },
        chainId,
      );

      const contractAddress = bytesToHex(deploymentTx.to);
      console.log(`Contract address will be: ${contractAddress}`);
      
      // Try to top up with decreasing amounts
      const topUpSuccess = await this.tryTopUp(
        contractAddress as Hex, 
        feeCredit
      );
      
      if (!topUpSuccess) {
        throw new Error("Failed to fund contract address after multiple attempts");
      }

      // Send deployment transaction
      const hash = await deploymentTx.send(client);
      console.log(`Deployment transaction sent with hash: ${hash}`);
      
      // Wait for deployment to be confirmed
      await new Promise(resolve => setTimeout(resolve, 5000));
      const receipts = await waitTillCompleted(client, hash);

      // Verify the deployment
      const code = await client.getCode(contractAddress as Hex);
      if (this.isEmptyCode(code)) {
        throw new Error('Contract deployment failed - no code at address');
      }

      return `Successfully deployed ${args.contractType} contract (external)!\n\n` +
             `- **Contract Address:** ${contractAddress}\n` +
             `  ${this.formatExplorerLink('address', contractAddress)}\n\n` +
             `- **Transaction Hash:** ${hash}\n` +
             `  ${this.formatExplorerLink('tx', hash)}\n\n` +
             `- **Shard ID:** ${args.shardId}`;
    } catch (error) {
      console.error('Contract deployment error:', error);
      throw new ContractDeploymentError(
        args.contractType,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  supportsNetwork = (_network: Network) => true;
}

export const nilContractActionProvider = () => new NilContractActionProvider(); 