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
  SmartAccountV1,
  generateSmartAccount,
  LocalECDSAKeySigner,
  generateRandomPrivateKey,
  waitTillCompleted,
  type Hex,
  type IPrivateKey
} from "@nilfoundation/niljs";
import "reflect-metadata";

import { 
  CreateSmartAccountSchema, 
  MintTokenSchema,
  TransferTokenSchema,
  BurnTokenSchema 
} from "./schemas";

export class NilSmartAccountActionProvider extends ActionProvider<EvmWalletProvider> {
  private rpcEndpoint: string;
  private faucetEndpoint: string;
  private clients: Map<number, PublicClient> = new Map();
  private accounts: Map<string, SmartAccountV1> = new Map();
  private privateKey: IPrivateKey | null = null;

  constructor() {
    super("nil-smart-account", []);
    
    if (!process.env.NIL_RPC_ENDPOINT) {
      throw new Error("NIL_RPC_ENDPOINT must be set");
    }
    
    if (!process.env.NIL_FAUCET_ENDPOINT) {
      throw new Error("NIL_FAUCET_ENDPOINT must be set");
    }

    this.rpcEndpoint = process.env.NIL_RPC_ENDPOINT;
    this.faucetEndpoint = process.env.NIL_FAUCET_ENDPOINT;
    
    // Initialize with a default private key if provided
    if (process.env.NIL_PRIVATE_KEY) {
      this.privateKey = process.env.NIL_PRIVATE_KEY as IPrivateKey;
    }
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
  
  // Format explorer link for addresses
  private formatExplorerLink(address: string): string {
    // Remove 0x prefix if present
    const cleanAddress = address.startsWith('0x') ? address.slice(2) : address;
    return `https://explore.nil.foundation/address/${cleanAddress}`;
  }

  // Format token amount to readable format
  private formatTokenAmount(amount: bigint): string {
    return amount.toLocaleString();
  }

  @CreateAction({
    name: "create-smart-account",
    description: "Create a new smart account on the NIL blockchain",
    schema: CreateSmartAccountSchema,
  })
  async createSmartAccount(
    args: z.infer<typeof CreateSmartAccountSchema>,
  ): Promise<string> {
    try {
      console.log(`Creating smart account on shard ${args.shardId}`);
      
      try {
        // Generate a smart account
        const smartAccount = await generateSmartAccount({
          shardId: args.shardId,
          rpcEndpoint: this.rpcEndpoint,
          faucetEndpoint: this.faucetEndpoint,
        });
        
        // Store the account for future use
        this.accounts.set(smartAccount.address, smartAccount);
        
        // Wait for deployment to complete
        await smartAccount.checkDeploymentStatus();
        
        // Get initial balance
        const balance = await smartAccount.getBalance();
        
        return `Smart Account Created Successfully:

- **Account Address:** ${smartAccount.address}
- **Shard:** ${args.shardId}
- **Initial Balance:** ${balance.toString()} wei
- **Explorer Link:** ${this.formatExplorerLink(smartAccount.address)}

This account is ready to use for token creation and transfers.`;
      } catch (apiError) {
        // More specific error handling for API-related issues
        console.error('API error creating smart account:', apiError);
        
        // Check if it's a faucet-specific error
        const errorMsg = apiError instanceof Error ? apiError.message : String(apiError);
        if (errorMsg.includes('faucet') || errorMsg.includes('withdraw')) {
          return `Unable to create smart account: The NIL faucet service is currently unavailable.

This is likely a temporary issue with the NIL blockchain infrastructure. Please try again later when the faucet service is restored.

In the meantime, you can still use other features:
- Check balances of existing addresses
- Verify contract deployments
- Explore the blockchain through the explorer at https://explore.nil.foundation`;
        }
        
        // Generic API error
        return `Unable to create smart account: API error.

This may be due to temporary issues with the NIL blockchain infrastructure. You can still check balances of existing addresses and verify contracts.`;
      }
    } catch (error) {
      console.error('Error creating smart account:', error);
      
      if (error instanceof Error) {
        return `Failed to create smart account: ${error.message}`;
      }
      
      return 'An unknown error occurred while creating the smart account.';
    }
  }

  @CreateAction({
    name: "mint-token",
    description: "Mint a new token for a smart account",
    schema: MintTokenSchema,
  })
  async mintToken(
    args: z.infer<typeof MintTokenSchema>,
  ): Promise<string> {
    try {
      console.log(`Minting token "${args.tokenName}" for account ${args.address}`);
      
      // Get the account
      const smartAccount = this.accounts.get(args.address);
      if (!smartAccount) {
        return `No smart account found with address ${args.address}. Please create a smart account first.`;
      }
      
      // Set token name if provided
      if (args.tokenName) {
        console.log(`Setting token name to ${args.tokenName}`);
        const nameHash = await smartAccount.setTokenName(args.tokenName);
        await waitTillCompleted(this.getClient(smartAccount.shardId), nameHash);
        console.log(`Token name set, transaction hash: ${nameHash}`);
      }
      
      // Mint the token
      const amount = BigInt(args.amount);
      console.log(`Minting ${amount} tokens`);
      const mintHash = await smartAccount.mintToken(amount);
      
      // Wait for the transaction to complete
      console.log(`Waiting for mint transaction to complete: ${mintHash}`);
      await waitTillCompleted(this.getClient(smartAccount.shardId), mintHash as Hex);
      
      return `Tokens Minted Successfully:

- **Token Name:** ${args.tokenName || "Default"}
- **Amount Minted:** ${this.formatTokenAmount(amount)} tokens
- **Smart Account:** ${smartAccount.address}
- **Transaction Hash:** ${mintHash}
- **Explorer Link:** ${this.formatExplorerLink(smartAccount.address)}

The tokens have been added to your smart account balance.`;
    } catch (error) {
      console.error('Error minting token:', error);
      
      if (error instanceof Error) {
        return `Failed to mint token: ${error.message}`;
      }
      
      return 'An unknown error occurred while minting the token.';
    }
  }

  @CreateAction({
    name: "transfer-token",
    description: "Transfer tokens from one smart account to another",
    schema: TransferTokenSchema,
  })
  async transferToken(
    args: z.infer<typeof TransferTokenSchema>,
  ): Promise<string> {
    try {
      console.log(`Transferring ${args.amount} tokens from ${args.fromAddress} to ${args.toAddress}`);
      
      // Get the source account
      const sourceAccount = this.accounts.get(args.fromAddress);
      if (!sourceAccount) {
        return `No smart account found with address ${args.fromAddress}. Please create a smart account first.`;
      }
      
      // Convert amount to BigInt
      const amount = BigInt(args.amount);
      
      // Create transaction to transfer tokens
      const transferHash = await sourceAccount.sendTransaction({
        to: args.toAddress as Hex,
        value: amount,
        feeCredit: BigInt(5000000), // Default fee credit
        tokens: args.tokenId ? [
          {
            id: args.tokenId as Hex,
            amount: amount,
          },
        ] : undefined,
      });
      
      // Wait for the transaction to complete
      console.log(`Waiting for transfer transaction to complete: ${transferHash}`);
      await waitTillCompleted(this.getClient(sourceAccount.shardId), transferHash as Hex);
      
      const tokenType = args.tokenId ? `Custom Token (${args.tokenId})` : "Native Token";
      
      return `Tokens Transferred Successfully:

- **Token Type:** ${tokenType}
- **Amount Transferred:** ${this.formatTokenAmount(amount)} tokens
- **From Account:** ${args.fromAddress}
- **To Account:** ${args.toAddress}
- **Transaction Hash:** ${transferHash}
- **Explorer Link:** ${this.formatExplorerLink(args.toAddress)}

The tokens have been transferred to the destination account.`;
    } catch (error) {
      console.error('Error transferring token:', error);
      
      if (error instanceof Error) {
        return `Failed to transfer token: ${error.message}`;
      }
      
      return 'An unknown error occurred while transferring the token.';
    }
  }

  @CreateAction({
    name: "burn-token",
    description: "Burn tokens from a smart account",
    schema: BurnTokenSchema,
  })
  async burnToken(
    args: z.infer<typeof BurnTokenSchema>,
  ): Promise<string> {
    try {
      console.log(`Burning ${args.amount} tokens from ${args.address}`);
      
      // Get the account
      const smartAccount = this.accounts.get(args.address);
      if (!smartAccount) {
        return `No smart account found with address ${args.address}. Please create a smart account first.`;
      }
      
      // Convert amount to BigInt
      const amount = BigInt(args.amount);
      
      // Burn the token
      const burnHash = await smartAccount.burnToken(amount);
      
      // Wait for the transaction to complete
      console.log(`Waiting for burn transaction to complete: ${burnHash}`);
      await waitTillCompleted(this.getClient(smartAccount.shardId), burnHash as Hex);
      
      return `Tokens Burned Successfully:

- **Amount Burned:** ${this.formatTokenAmount(amount)} tokens
- **Smart Account:** ${args.address}
- **Transaction Hash:** ${burnHash}
- **Explorer Link:** ${this.formatExplorerLink(args.address)}

The tokens have been permanently removed from circulation.`;
    } catch (error) {
      console.error('Error burning token:', error);
      
      if (error instanceof Error) {
        return `Failed to burn token: ${error.message}`;
      }
      
      return 'An unknown error occurred while burning the token.';
    }
  }

  supportsNetwork = (_network: Network) => true;
}

export const nilSmartAccountActionProvider = () => new NilSmartAccountActionProvider();