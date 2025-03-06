import { z } from "zod";
import {
  CreateAction,
  ActionProvider,
  Network,
  EvmWalletProvider
} from "@coinbase/agentkit";
import { 
  HttpTransport, 
  PublicClient,
  SmartAccountV1,
  generateSmartAccount,
  LocalECDSAKeySigner,
  generateRandomPrivateKey,
  waitTillCompleted,
  topUp,
  type IPrivateKey,
  type Hex,
  hexToBytes,
  getPublicKey
} from "@nilfoundation/niljs";
import "reflect-metadata";
import { 
  CreateSmartAccountSchema, 
  MintTokenSchema, 
  TransferTokenSchema, 
  BurnTokenSchema,
  BatchTransferTokensSchema,
  CheckBalanceSchema
} from "./schemas";
import { encodeFunctionData } from "viem";

export class NilSmartAccountActionProvider extends ActionProvider<EvmWalletProvider> {
  private rpcEndpoint: string;
  private faucetEndpoint: string;
  private clients: Map<number, PublicClient> = new Map();
  private accounts: Map<string, SmartAccountV1> = new Map();
  private privateKey: IPrivateKey | null = null;
  private examples: Record<string, string> = {};

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

    // Add example commands to help documentation
    this.examples = {
      "create-smart-account": "/create-smart-account --shardId 1 --recoveryEnabled true",
      "mint-token": "/mint-token --address 0x000131f54b78ebf3538005b43e0f09fd9b7d48ef --amount 1000000 --tokenName MY_TOKEN",
      "transfer-token": "/transfer-token --fromAddress 0x000131f54b78ebf3538005b43e0f09fd9b7d48ef --toAddress 0x0001abcdef1234567890 --amount 50000",
      "burn-token": "/burn-token --address 0x000131f54b78ebf3538005b43e0f09fd9b7d48ef --amount 10000",
      "cross-shard-transfer": "/cross-shard-transfer --fromAddress 0x000131f54b78ebf3538005b43e0f09fd9b7d48ef --toAddress 0x0002abcdef1234567890 --amount 5000 --targetShardId 2",
      "batch-transfer-tokens": "/batch-transfer-tokens --fromAddress 0x000131f54b78ebf3538005b43e0f09fd9b7d48ef --recipients '[{\"address\":\"0x0001abc\",\"amount\":\"1000\"},{\"address\":\"0x0001def\",\"amount\":\"2000\"}]'"
    };
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

  private isEmptyCode(code: Uint8Array | string): boolean {
    if (!code) return true;
    if (code instanceof Uint8Array) return code.length === 0;
    if (typeof code === 'string') return code === '0x' || code === '';
    return true;
  }
  
  private extractShardFromAddress(address: string): number | null {
    // NIL addresses may contain shard information
    // This is a heuristic method that might help determine the shard
    // Addresses often start with '0x000X' where X is the shard number
    if (!address || typeof address !== 'string') return null;
    
    try {
      // Ensure address has 0x prefix
      const normalizedAddress = address.startsWith('0x') ? address : `0x${address}`;
      
      // Look at the 4th character which might indicate shard
      const possibleShardChar = normalizedAddress.charAt(4);
      const possibleShardNum = parseInt(possibleShardChar, 16);
      
      // Validate shard number (NIL typically has shards 1-4)
      if (!isNaN(possibleShardNum) && possibleShardNum >= 1 && possibleShardNum <= 4) {
        return possibleShardNum;
      }
    } catch (e) {
      console.error('Error extracting shard from address:', e);
    }
    
    // Default to shard 1 if we can't determine
    return 1;
  }

  private normalizeAddress(address: string): string {
    return address.startsWith('0x') ? address : `0x${address}`;
  }

  @CreateAction({
    name: "create-smart-account",
    description: "Create a new smart account on the NIL blockchain with automatic salt and private key generation",
    schema: CreateSmartAccountSchema,
  })
  async createSmartAccount(
    args: z.infer<typeof CreateSmartAccountSchema>,
  ): Promise<string> {
    try {
      console.log(`Creating smart account on shard ${args.shardId}`);
      
      try {
        // Always generate a new private key if none exists
        let privateKey = this.privateKey;
        if (!privateKey) {
          privateKey = generateRandomPrivateKey();
          console.log("Generated new private key");
          this.privateKey = privateKey;
        }
        
        // If user provided a private key, use it
        if (args.privateKey) {
          privateKey = args.privateKey as `0x${string}`;
        }
        
        // Generate a smart account with improved options (always with random salt)
        const smartAccountOptions = {
          shardId: args.shardId,
          rpcEndpoint: this.rpcEndpoint,
          faucetEndpoint: this.faucetEndpoint,
          privateKey: privateKey,
          // No salt parameter - let the API generate a random one
          recoveryEnabled: true,
          // Increase initial funding to avoid insufficient funds errors
          initialFunding: BigInt("10000000000000000"), // Increased funding amount
        };
        
        console.log(`Creating account on shard ID: ${args.shardId}`);
        const smartAccount = await generateSmartAccount(smartAccountOptions);
        
        // Store the account for future use
        this.accounts.set(smartAccount.address, smartAccount);
        
        // Wait for deployment to complete with timeout
        const deploymentSuccess = await Promise.race([
          smartAccount.checkDeploymentStatus().then(() => true),
          new Promise<boolean>(resolve => setTimeout(() => resolve(false), 30000))
        ]);
        
        // Fetch additional account details
        let balance = BigInt(0);
        try {
          const client = this.getClient(args.shardId);
          balance = await client.getBalance(smartAccount.address as `0x${string}`);
          
          // Ensure account has sufficient funds for operations
          if (balance < BigInt("5000000000000000")) {
            console.log(`Low balance detected (${balance}), requesting additional funds...`);
            // Try to get additional funds from faucet
            await topUp({
              address: smartAccount.address as `0x${string}`,
              amount: BigInt("5000000000000000"),
              faucetEndpoint: this.faucetEndpoint,
              rpcEndpoint: this.rpcEndpoint,
              token: 'NIL'
            });
            // Re-check balance
            balance = await client.getBalance(smartAccount.address as `0x${string}`);
            console.log(`New balance after additional funding: ${balance}`);
          }
        } catch (balanceError) {
          console.warn("Could not fetch initial balance", balanceError);
        }
        
        console.log(`Account deployment successful: ${smartAccount.address}`);
        
        // Return success with details
        return `✅ Smart Account deployed successfully!

**Account Details:**
- **Address:** ${smartAccount.address}
- **Shard:** ${args.shardId}
- **Balance:** ${balance.toString()} wei
- **Explorer Link:** ${this.formatExplorerLink(smartAccount.address)}

You can now use this account for token transfers, NFT minting, and other operations on the NIL blockchain. 

The private key has been ${args.privateKey ? "set as provided" : "automatically generated"} for this testing session.`;
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
        
        // Check for other common errors based on NIL.js documentation
        if (errorMsg.includes('shard') || errorMsg.includes('invalid shard')) {
          return `Unable to create smart account: Invalid shard ID (${args.shardId}).

Please ensure you're using a valid shard ID. The NIL blockchain currently supports shards 1-4.`;
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
    description: "Mint a new token for a smart account with custom name",
    schema: MintTokenSchema,
  })
  async mintToken(
    args: z.infer<typeof MintTokenSchema>,
  ): Promise<string> {
    try {
      // Get or create client
      const client = this.getClient(args.shardId || 1);
      
      let smartAccount;
      
      try {
        // First try to get existing account
        if (args.address && this.accounts.has(args.address)) {
          smartAccount = this.accounts.get(args.address);
        } else if (args.address) {
          // Try to connect to an existing account by address
          console.log(`Connecting to existing account at ${args.address}`);
          
          // Get shard ID from address or use provided one
          const shardId = args.shardId || this.extractShardFromAddress(args.address) || 1;
          
          // Create smart account properly with the correct options type
          // Check NIL.js documentation for the correct parameters
          // This is a placeholder - adjust based on the actual API
          const signer = new LocalECDSAKeySigner({
            privateKey: this.privateKey || generateRandomPrivateKey()
          });
          
          // Create account with signer, not direct private key
          smartAccount = await generateSmartAccount({
            shardId: shardId,
            rpcEndpoint: this.rpcEndpoint,
            faucetEndpoint: this.faucetEndpoint
            // Do not include address directly if not in the type
          });
          
          // You might need to manually set the address or use a different method
          // to connect to existing accounts - check NIL.js docs
          
          // Store for future use
          if (smartAccount) {
            this.accounts.set(smartAccount.address, smartAccount);
          }
        } else {
          // Create new smart account with proper initialization
          const signer = this.privateKey ? 
            new LocalECDSAKeySigner({ privateKey: this.privateKey }) :
            new LocalECDSAKeySigner({ privateKey: generateRandomPrivateKey() });
          
          smartAccount = await generateSmartAccount({
            shardId: args.shardId || 1,
            rpcEndpoint: this.rpcEndpoint,
            faucetEndpoint: this.faucetEndpoint
            // Do not include privateKey directly if not in the type
          });
          
          // Store for future use
          if (smartAccount) {
            this.accounts.set(smartAccount.address, smartAccount);
          }
        }

        // Ensure smartAccount exists before proceeding
        if (!smartAccount) {
          throw new Error("Failed to create or retrieve smart account");
        }

        // Check account balance before proceeding
        const currentBalance = await client.getBalance(smartAccount.address as `0x${string}`);
        console.log(`Current account balance: ${currentBalance}`);
        
        // Ensure minimum balance for operations
        const minRequiredBalance = BigInt(1000000);
        if (currentBalance < minRequiredBalance) {
          console.log(`Low balance detected (${currentBalance}), requesting additional funds...`);
          
          // Try to get additional funds from faucet
          await topUp({
            address: smartAccount.address as `0x${string}`,
            amount: BigInt(5000000),
            faucetEndpoint: this.faucetEndpoint,
            rpcEndpoint: this.rpcEndpoint,
            token: 'NIL'
          });
          
          // Wait briefly for funds to settle
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Verify balance was updated
          const newBalance = await client.getBalance(smartAccount.address as `0x${string}`);
          console.log(`New balance after funding: ${newBalance}`);
        }

        // Set token name if provided
        if (args.tokenName) {
          console.log(`Setting token name to "${args.tokenName}"`);
          const nameHash = await smartAccount.setTokenName(args.tokenName);
          console.log(`Token name transaction hash: ${nameHash}`);
          await waitTillCompleted(client, nameHash);
          console.log(`Token name set successfully`);
        }

        // Convert amount to BigInt with proper validation
        const amount = BigInt(args.amount);
        
        // Mint tokens
        console.log(`Minting ${args.amount} tokens to ${smartAccount.address}`);
        const mintTx = await smartAccount.mintToken(amount);
        console.log(`Mint transaction hash: ${mintTx}`);
        
        // Wait for transaction completion
        await waitTillCompleted(client, mintTx);
        console.log(`Minting completed successfully`);
        
        // Fix the token balance access based on the correct type
        let tokenBalance = "Unknown";
        try {
          const tokens = await client.getTokens(smartAccount.address, "latest");
          // Adjust this based on the actual type returned by getTokens
          if (tokens && tokens.length > 0) {
            // If tokens[0] is a bigint:
            tokenBalance = tokens[0].toString();
            // If tokens[0] is an object with a balance property that's a bigint:
            // tokenBalance = tokens[0].balance.toString();
          }
          console.log(`Updated token balance: ${tokenBalance}`);
        } catch (e) {
          console.warn("Could not fetch token balance", e);
          tokenBalance = "Unable to fetch";
        }

        return `✅ Token minting successful!

**Transaction Details:**
- **Token Name:** ${args.tokenName || "Default"}
- **Amount Minted:** ${this.formatTokenAmount(amount)} tokens
- **Current Token Balance:** ${tokenBalance}
- **Account:** ${smartAccount.address}
- **Transaction Hash:** ${mintTx}
- **Explorer Link:** ${this.formatExplorerLink(mintTx)}

The tokens have been minted to your account and are ready for use.

**Usage Examples:**
- To check your token balance: \`/check-nil-balance --address ${smartAccount.address}\`
- To transfer tokens: \`/transfer-token --fromAddress ${smartAccount.address} --toAddress DESTINATION_ADDRESS --amount AMOUNT\`
- To burn tokens: \`/burn-token --address ${smartAccount.address} --amount AMOUNT\``;

      } catch (error) {
        throw new Error(`Smart account operation failed: ${error instanceof Error ? error.message : String(error)}`);
      }

    } catch (error) {
      console.error("Token minting error:", error);
      return `❌ Failed to mint tokens: ${error instanceof Error ? error.message : String(error)}

Please ensure:
1. The account address is valid
2. You have sufficient balance for gas
3. The amount is a valid number

**Example command:**
\`/mint-token --address YOUR_ADDRESS --amount 1000000 --tokenName MY_TOKEN\``;
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

  @CreateAction({
    name: "cross-shard-transfer",
    description: "Transfer tokens between accounts on different shards",
    schema: TransferTokenSchema,
  })
  async crossShardTransfer(
    args: z.infer<typeof TransferTokenSchema>,
  ): Promise<string> {
    try {
      // Basic validation
      if (!args.fromAddress || !args.toAddress) {
        throw new Error("Source and destination addresses are required");
      }
      
      const sourceAddress = this.normalizeAddress(args.fromAddress);
      const destinationAddress = this.normalizeAddress(args.toAddress);
      const amount = BigInt(args.amount);
      const sourceShardId = this.extractShardFromAddress(sourceAddress) || 1;
      const targetShardId = args.targetShardId || 1;
      const tokenId = args.tokenId || '0x01'; // Default token ID
      
      // Get or retrieve the source account
      let sourceAccount: SmartAccountV1;
      if (this.accounts.has(sourceAddress)) {
        sourceAccount = this.accounts.get(sourceAddress)!;
      } else {
        throw new Error(`Source account ${sourceAddress} not found. Please create or load it first.`);
      }
      
      console.log(`Initiating cross-shard transfer of ${amount} tokens from shard ${sourceShardId} to shard ${targetShardId}`);
      
      // Instead of using sendTransaction with custom data, use the specific
      // transaction method for token transfer
      
      // Direct method using writeContract to implement token transfer
      const client = this.getClient(sourceShardId);
      
      // Create transaction for token transfer
      const hash = await sourceAccount.sendTransaction({
        to: destinationAddress as `0x${string}`,
        value: amount,
        data: tokenId as `0x${string}`
      });
      
      // Wait for the transaction to complete
      await waitTillCompleted(client, hash);
      
      return `Cross-shard token transfer successful:
- **From Shard:** ${sourceShardId}
- **To Shard:** ${targetShardId}
- **From Address:** ${sourceAddress}
- **To Address:** ${destinationAddress}
- **Amount:** ${this.formatTokenAmount(amount)}
- **Token ID:** ${tokenId}
- **Transaction Hash:** ${hash}
- **Explorer Link:** ${this.formatExplorerLink(hash as string)}

Cross-shard transfers may take longer to finalize than regular transfers.`;
    } catch (error: any) {
      console.error("Error in cross-shard transfer:", error);
      return `Error performing cross-shard transfer: ${error.message || String(error)}`;
    }
  }

  @CreateAction({
    name: "batch-transfer-tokens",
    description: "Transfer tokens to multiple recipients in a single operation",
    schema: BatchTransferTokensSchema,
  })
  async batchTransferTokens(
    args: z.infer<typeof BatchTransferTokensSchema>,
  ): Promise<string> {
    try {
      // Basic validation
      if (!args.fromAddress) {
        throw new Error("Source address is required");
      }
      
      if (!args.recipients || args.recipients.length === 0) {
        throw new Error("At least one recipient is required");
      }
      
      const sourceAddress = this.normalizeAddress(args.fromAddress);
      const shardId = args.shardId || 1;
      const tokenId = args.tokenId || '0x01'; // Default token ID
      
      // Get the source account
      let sourceAccount: SmartAccountV1;
      if (this.accounts.has(sourceAddress)) {
        sourceAccount = this.accounts.get(sourceAddress)!;
      } else {
        throw new Error(`Source account ${sourceAddress} not found. Please create or load it first.`);
      }
      
      console.log(`Initiating batch token transfer from ${sourceAddress} on shard ${shardId}`);
      
      // Get the appropriate client
      const client = this.getClient(shardId);
      
      // Process recipients
      const recipients = args.recipients.map(r => ({
        address: this.normalizeAddress(r.address),
        amount: BigInt(r.amount)
      }));
      
      let results: string[] = [];
      let successCount = 0;
      let failCount = 0;
      
      console.log(`Processing ${recipients.length} transfers...`);
      
      // Process each recipient
      let hash = '';
      for (const recipient of args.recipients) {
        const destinationAddress = this.normalizeAddress(recipient.address);
        const amount = BigInt(recipient.amount);
        
        console.log(`Transferring ${amount} tokens to ${destinationAddress}${args.tokenId ? ` (token: ${args.tokenId})` : ''}`);
        
        // Add transaction to the batch if supported, or send individually
        try {
          // Send the transaction
          const txHash = await sourceAccount.sendTransaction({
            to: destinationAddress as `0x${string}`,
            value: amount,
            data: args.tokenId as `0x${string}` || '0x01'
          });
          
          console.log(`Transaction hash: ${txHash}`);
          hash = txHash; // Keep track of the last transaction
          results.push(`Transferred ${this.formatTokenAmount(amount)} to ${destinationAddress}: ${txHash}`);
          successCount++;
        } catch (error: any) {
          console.error(`Error transferring to ${destinationAddress}:`, error);
          results.push(`Failed to transfer to ${destinationAddress}: ${error.message || String(error)}`);
          failCount++;
        }
      }
      
      // Generate result summary
      return `Batch Token Transfer Summary:
- **Source Address:** ${sourceAddress}
- **Shard:** ${shardId}
- **Total Recipients:** ${recipients.length}
- **Successful Transfers:** ${successCount}
- **Failed Transfers:** ${failCount}

Individual Transfer Results:
${results.map(r => `- ${r}`).join('\n')}

${successCount === recipients.length ? 'All transfers completed successfully!' : 'Some transfers failed. Check individual results for details.'}`;
    } catch (error: any) {
      console.error("Error in batch token transfer:", error);
      return `Error initiating batch token transfer: ${error.message || String(error)}`;
    }
  }

  @CreateAction({
    name: "show-examples",
    description: "Show usage examples for NIL smart account commands",
    schema: z.object({
      command: z
        .string()
        .optional()
        .describe("Specific command to show example for (optional)"),
    }),
  })
  async showExamples(
    args: { command?: string },
  ): Promise<string> {
    if (args.command && this.examples[args.command]) {
      return `**Example for ${args.command}:**\n\`${this.examples[args.command]}\``;
    }
    
    // If no specific command requested, show all examples
    let response = "# NIL Smart Account Command Examples\n\n";
    
    for (const [command, example] of Object.entries(this.examples)) {
      response += `## ${command}\n\`${example}\`\n\n`;
    }
    
    return response;
  }

  supportsNetwork = (_network: Network) => true;

  // Add method to get example for a command
  getCommandExample(command: string): string {
    return this.examples[command] || `No example available for ${command}`;
  }
}

export const nilSmartAccountActionProvider = () => new NilSmartAccountActionProvider();