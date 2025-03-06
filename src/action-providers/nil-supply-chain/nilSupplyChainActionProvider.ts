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
  generateSmartAccount,
  waitTillCompleted,
  type Hex,
  bytesToHex,
  hexToBytes,
  topUp,
  ExternalTransactionEnvelope
} from "@nilfoundation/niljs";
import "reflect-metadata";
import * as crypto from 'crypto';
import { Abi, encodeFunctionData } from "viem";

import { 
  DeployRetailerSchema, 
  DeployManufacturerSchema,
  OrderProductSchema,
  GetProductsSchema,
  DeploySupplyChainSchema
} from "./schemas";
import { 
  DEFAULT_SHARD_ID,
  CONTRACT_TYPES,
  RETAILER_ABI,
  MANUFACTURER_ABI,
  MANUFACTURER_BYTECODE
} from "./constants";
import { ContractDeploymentError, ContractInteractionError } from "./errors";

// Since the methods aren't available in NIL.js, we'll implement our own key generation
function generateKeyPair(): { publicKey: Uint8Array, privateKey: Uint8Array } {
  // Create a simple keypair using Node.js crypto
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { format: 'der', type: 'spki' },
    privateKeyEncoding: { format: 'der', type: 'pkcs8' }
  });
  
  // Extract just the key data
  const publicKeyBytes = new Uint8Array(publicKey.slice(-32));
  const privateKeyBytes = new Uint8Array(privateKey.slice(-32));
  
  return {
    publicKey: publicKeyBytes,
    privateKey: privateKeyBytes
  };
}

export class NilSupplyChainActionProvider extends ActionProvider<EvmWalletProvider> {
  private rpcEndpoint: string;
  private faucetEndpoint: string;
  private clients: Map<number, PublicClient> = new Map();

  constructor() {
    super("nil-supply-chain", []);
    
    if (!process.env.NIL_RPC_ENDPOINT) {
      throw new Error("NIL_RPC_ENDPOINT must be set");
    }
    if (!process.env.NIL_FAUCET_ENDPOINT) {
      throw new Error("NIL_FAUCET_ENDPOINT must be set");
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
    if (!code) return true;
    if (code instanceof Uint8Array) return code.length === 0;
    if (typeof code === 'string') return code === '0x' || code === '';
    return true;
  }

  private formatExplorerLink(type: 'address' | 'tx', value: string): string {
    // Remove 0x prefix if present
    const cleanValue = value.startsWith('0x') ? value.slice(2) : value;
    return `https://explore.nil.foundation/${type}/${cleanValue}`;
  }

  private normalizeAddress(address: string): string {
    return address.startsWith('0x') ? address : `0x${address}`;
  }
  
  // Generate a random salt to avoid address collisions
  private generateRandomSalt(): bigint {
    // Generate a small random number between 0 and 9999 as recommended in NIL documentation
    const randomValue = Math.floor(Math.random() * 10000);
    console.log(`Using salt: ${randomValue}`);
    return BigInt(randomValue);
  }
  
  @CreateAction({
    name: "deploy-retailer-contract",
    description: "Deploy a Retailer contract to the NIL blockchain",
    schema: DeployRetailerSchema,
  })
  async deployRetailerContract(
    args: z.infer<typeof DeployRetailerSchema>,
  ): Promise<string> {
    try {
      const shardId = args.shardId || DEFAULT_SHARD_ID;
      console.log(`Deploying Retailer contract to shard ${shardId}`);
      
      const client = this.getClient(shardId);
      const gasPrice = await client.getGasPrice(shardId);
      
      // Create a smart account for contract deployment
      const smartAccount = await generateSmartAccount({
        shardId: shardId,
        rpcEndpoint: this.rpcEndpoint,
        faucetEndpoint: this.faucetEndpoint,
      });
      
      console.log(`Created smart account: ${smartAccount.address}`);
      
      // Generate a random salt value
      const salt = args.salt ? BigInt(args.salt) : this.generateRandomSalt();
      
      // Calculate fee credit
      const feeCredit = 1_000_000n * gasPrice;
      
      // Get contract details
      const contractDetails = CONTRACT_TYPES.RETAILER;
      const bytecode = contractDetails.bytecode.startsWith('0x') 
        ? contractDetails.bytecode as Hex
        : `0x${contractDetails.bytecode}` as Hex;
      
      // Deploy the contract
      console.log(`Deploying Retailer contract with salt ${salt}...`);
      const { address: contractAddress, hash } = await smartAccount.deployContract({
        bytecode,
        abi: RETAILER_ABI as unknown as Abi,
        args: [], // No constructor arguments for Retailer contract
        feeCredit,
        salt,
        shardId,
      });
      
      console.log(`Deployment transaction sent with hash: ${hash}`);
      console.log(`Contract address: ${contractAddress}`);
      
      // Wait for deployment confirmation
      try {
        await waitTillCompleted(client, hash as Hex);
        console.log("Deployment transaction completed!");
        
        // Verify contract code exists
        let verificationAttempts = 0;
        let isVerified = false;
        
        while (verificationAttempts < 10 && !isVerified) {
          try {
            const code = await client.getCode(contractAddress as Hex);
            if (!this.isEmptyCode(code)) {
              isVerified = true;
              break;
            }
          } catch (error) {
            console.log(`Verification attempt ${verificationAttempts + 1} failed:`, error);
          }
          
          verificationAttempts++;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        if (isVerified) {
          return `Successfully deployed Retailer contract!\n\n` +
                 `- **Contract Address:** ${contractAddress}\n` +
                 `  ${this.formatExplorerLink('address', contractAddress as string)}\n\n` +
                 `- **Transaction Hash:** ${hash}\n` +
                 `  ${this.formatExplorerLink('tx', hash as string)}\n\n` +
                 `- **Shard ID:** ${shardId}\n\n` +
                 `The contract has been deployed and is ready for use. You can now deploy a Manufacturer contract and link it to this Retailer.`;
        } else {
          return `Retailer contract deployment transaction was confirmed, but contract code verification timed out.\n\n` +
                 `- **Contract Address:** ${contractAddress}\n` +
                 `  ${this.formatExplorerLink('address', contractAddress as string)}\n\n` +
                 `- **Transaction Hash:** ${hash}\n` +
                 `  ${this.formatExplorerLink('tx', hash as string)}\n\n` +
                 `- **Shard ID:** ${shardId}\n\n` +
                 `Please check the explorer to verify if the contract was deployed successfully.`;
        }
      } catch (error) {
        console.error("Error waiting for deployment:", error);
        return `Retailer contract deployment transaction was sent, but there was an error confirming its completion.\n\n` +
               `- **Contract Address:** ${contractAddress}\n` +
               `- **Transaction Hash:** ${hash}\n` +
               `- **Shard ID:** ${shardId}\n\n` +
               `Please check the explorer to verify if the contract was deployed successfully.`;
      }
    } catch (error) {
      console.error("Error deploying Retailer contract:", error);
      throw new ContractDeploymentError(
        "Retailer",
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }
  
  @CreateAction({
    name: "deploy-manufacturer-contract",
    description: "Deploy a Manufacturer contract to the NIL blockchain",
    schema: DeployManufacturerSchema,
  })
  async deployManufacturerContract(
    args: z.infer<typeof DeployManufacturerSchema>,
  ): Promise<string> {
    try {
      const { publicKey, retailerAddress, shardId = 1, salt, useInternalDeployment = false } = args;
      
      if (!retailerAddress) {
        throw new Error("Retailer address is required to deploy the Manufacturer contract. Please deploy a Retailer contract first.");
      }
      
      console.log(`Deploying Manufacturer contract to shard ${shardId}`);
      
      // Get the appropriate client for the shard
      const client = this.getClient(shardId);
      
      // Generate a key pair if not provided
      let pubkey: Uint8Array;
      if (publicKey) {
        // Convert hex string to Uint8Array
        pubkey = hexToBytes(publicKey.startsWith('0x') ? publicKey as `0x${string}` : `0x${publicKey}` as `0x${string}`);
      } else {
        // Generate a fresh key pair if none provided
        const keyPair = generateKeyPair();
        pubkey = keyPair.publicKey;
      }
      
      // Normalize retailer address
      const retailerAddressNormalized = this.normalizeAddress(retailerAddress);
      
      // Get bytecode from constants
      const bytecode = MANUFACTURER_BYTECODE;
      
      // Generate a random salt value if not provided
      const saltValue = salt ? BigInt(salt) : this.generateRandomSalt();
      
      // Create a smart account for contract deployment
      const smartAccount = await generateSmartAccount({
        shardId: shardId,
        rpcEndpoint: this.rpcEndpoint,
        faucetEndpoint: this.faucetEndpoint,
      });
      
      console.log(`Created smart account: ${smartAccount.address}`);
      
      // Calculate fee credit
      const gasPrice = await client.getGasPrice(shardId);
      const feeCredit = 1_000_000n * gasPrice;
      
      // Deploy the contract with constructor arguments
      console.log(`Deploying Manufacturer contract with salt ${saltValue}...`);
      const { address: contractAddress, hash } = await smartAccount.deployContract({
        bytecode,
        abi: MANUFACTURER_ABI as unknown as Abi,
        args: [pubkey, retailerAddressNormalized], // Pass pubkey and retailer address to constructor
        feeCredit,
        salt: saltValue,
        shardId,
      });
      
      console.log(`Deployment transaction sent with hash: ${hash}`);
      console.log(`Contract address: ${contractAddress}`);
      
      // Wait for deployment confirmation
      try {
        await waitTillCompleted(client, hash as Hex);
        console.log("Deployment transaction completed!");
        
        // Verify contract code exists
        let verificationAttempts = 0;
        let isVerified = false;
        
        while (verificationAttempts < 10 && !isVerified) {
          try {
            const code = await client.getCode(contractAddress as Hex);
            if (!this.isEmptyCode(code)) {
              isVerified = true;
              break;
            }
          } catch (error) {
            console.log(`Verification attempt ${verificationAttempts + 1} failed:`, error);
          }
          
          verificationAttempts++;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        // When using a generated key pair, we should return the public key
        const pubkeyHex = bytesToHex(pubkey); 
        
        if (isVerified) {
          return `Successfully deployed Manufacturer contract!\n\n` +
                 `- **Contract Address:** ${contractAddress}\n` +
                 `  ${this.formatExplorerLink('address', contractAddress as string)}\n\n` +
                 `- **Transaction Hash:** ${hash}\n` +
                 `  ${this.formatExplorerLink('tx', hash as string)}\n\n` +
                 `- **Retailer Address:** ${retailerAddressNormalized}\n` +
                 `- **Public Key:** ${pubkeyHex}\n` +
                 `- **Shard ID:** ${shardId}\n\n` +
                 `The contract has been deployed and is linked to the Retailer contract. You can now order products through the Retailer.`;
        } else {
          return `Manufacturer contract deployment transaction was confirmed, but contract code verification timed out.\n\n` +
                 `- **Contract Address:** ${contractAddress}\n` +
                 `  ${this.formatExplorerLink('address', contractAddress as string)}\n\n` +
                 `- **Transaction Hash:** ${hash}\n` +
                 `  ${this.formatExplorerLink('tx', hash as string)}\n\n` +
                 `- **Retailer Address:** ${retailerAddressNormalized}\n` +
                 `- **Public Key:** ${pubkeyHex}\n` +
                 `- **Shard ID:** ${shardId}\n\n` +
                 `Please check the explorer to verify if the contract was deployed successfully.`;
        }
      } catch (error) {
        console.error("Error waiting for deployment:", error);
        return `Manufacturer contract deployment transaction was sent, but there was an error confirming its completion.\n\n` +
               `- **Contract Address:** ${contractAddress}\n` +
               `- **Transaction Hash:** ${hash}\n` +
               `- **Shard ID:** ${shardId}\n\n` +
               `Please check the explorer to verify if the contract was deployed successfully.`;
      }
    } catch (error) {
      console.error("Error deploying Manufacturer contract:", error);
      throw new ContractDeploymentError(
        "Manufacturer",
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }
  
  @CreateAction({
    name: "order-product",
    description: "Order a product through the Retailer contract",
    schema: OrderProductSchema,
  })
  async orderProduct(
    args: z.infer<typeof OrderProductSchema>,
  ): Promise<string> {
    try {
      const shardId = args.shardId || DEFAULT_SHARD_ID;
      console.log(`Ordering product on shard ${shardId}`);
      
      const client = this.getClient(shardId);
      
      // Normalize addresses
      const retailerAddress = this.normalizeAddress(args.retailerAddress);
      const manufacturerAddress = this.normalizeAddress(args.manufacturerAddress);
      
      // Create a smart account for transaction
      const smartAccount = await generateSmartAccount({
        shardId: shardId,
        rpcEndpoint: this.rpcEndpoint,
        faucetEndpoint: this.faucetEndpoint,
      });
      
      console.log(`Created smart account: ${smartAccount.address}`);
      
      // Calculate fee credit
      const gasPrice = await client.getGasPrice(shardId);
      const feeCredit = 500_000n * gasPrice;
      
      // Encode function call to orderProduct
      const data = encodeFunctionData({
        abi: RETAILER_ABI as unknown as Abi,
        functionName: 'orderProduct',
        args: [manufacturerAddress, args.productName]
      });
      
      // Send transaction
      console.log(`Ordering product "${args.productName}" from manufacturer ${manufacturerAddress}...`);
      const hash = await smartAccount.sendTransaction({
        to: retailerAddress as Hex,
        data,
        value: 0n,
        feeCredit
      });
      
      console.log(`Transaction sent with hash: ${hash}`);
      
      // Wait for transaction confirmation
      try {
        await waitTillCompleted(client, hash as Hex);
        console.log("Transaction completed!");
        
        return `Successfully ordered product "${args.productName}"!\n\n` +
               `- **Transaction Hash:** ${hash}\n` +
               `  ${this.formatExplorerLink('tx', hash as string)}\n\n` +
               `- **Retailer Contract:** ${retailerAddress}\n` +
               `  ${this.formatExplorerLink('address', retailerAddress)}\n\n` +
               `- **Manufacturer Contract:** ${manufacturerAddress}\n` +
               `  ${this.formatExplorerLink('address', manufacturerAddress)}\n\n` +
               `- **Shard ID:** ${shardId}\n\n` +
               `The order has been placed. You can check the product list using the get-products action.`;
      } catch (error) {
        console.error("Error waiting for transaction:", error);
        return `Product order transaction was sent, but there was an error confirming its completion.\n\n` +
               `- **Transaction Hash:** ${hash}\n` +
               `- **Retailer Contract:** ${retailerAddress}\n` +
               `- **Manufacturer Contract:** ${manufacturerAddress}\n` +
               `- **Shard ID:** ${shardId}\n\n` +
               `Please check the explorer to verify if the transaction was successful.`;
      }
    } catch (error) {
      console.error("Error ordering product:", error);
      throw new ContractInteractionError(
        "Retailer",
        "orderProduct",
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  supportsNetwork = (_network: Network) => true;
}

export const nilSupplyChainActionProvider = () => new NilSupplyChainActionProvider();