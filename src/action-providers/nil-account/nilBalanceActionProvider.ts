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
  type Hex
} from "@nilfoundation/niljs";
import "reflect-metadata";

import { CheckBalanceSchema } from "./schemas";

export class NilBalanceActionProvider extends ActionProvider<EvmWalletProvider> {
  private rpcEndpoint: string;
  private clients: Map<number, PublicClient> = new Map();

  constructor() {
    super("nil-balance", []);
    
    if (!process.env.NIL_RPC_ENDPOINT) {
      throw new Error("NIL_RPC_ENDPOINT must be set");
    }

    this.rpcEndpoint = process.env.NIL_RPC_ENDPOINT;
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

  // Format large bigint values to readable format with units
  private formatBalance(balance: bigint): string {
    // Convert to a readable string with decimal
    const fullNumber = balance.toString();
    
    // For very small or zero values
    if (balance < BigInt(1000000000000000)) {
      return `${balance.toString()} wei`;
    }
    
    // Convert to NIL units (similar to ETH, 18 decimals)
    const wholePart = fullNumber.slice(0, -18) || "0";
    const decimalPart = fullNumber.slice(-18).padStart(18, "0");
    
    // Format with 6 decimal places max
    const formattedDecimal = decimalPart.slice(0, 6).replace(/0+$/, "");
    
    if (formattedDecimal) {
      return `${wholePart}.${formattedDecimal} NIL`;
    } else {
      return `${wholePart} NIL`;
    }
  }

  // Format explorer link for addresses
  private formatExplorerLink(address: string): string {
    // Remove 0x prefix if present
    const cleanAddress = address.startsWith('0x') ? address.slice(2) : address;
    return `https://explore.nil.foundation/address/${cleanAddress}`;
  }

  @CreateAction({
    name: "check-nil-balance",
    description: "Check the balance of an address on the NIL blockchain",
    schema: CheckBalanceSchema,
  })
  async checkBalance(
    args: z.infer<typeof CheckBalanceSchema>,
  ): Promise<string> {
    try {
      console.log(`Checking balance for address: ${args.address} on shard ${args.shardId}`);
      
      // Get client for specified shard
      const client = this.getClient(args.shardId);
      
      // Ensure address has 0x prefix and assert it as Hex type
      const formattedAddress = args.address.startsWith('0x') 
        ? args.address as Hex
        : `0x${args.address}` as Hex;
      
      // Get balance with a timeout to handle potential API issues
      const balancePromise = client.getBalance(formattedAddress);
      
      // Set a timeout for the balance query (10 seconds)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Balance query timed out')), 10000);
      });
      
      // Race between the balance query and the timeout
      const balance = await Promise.race([balancePromise, timeoutPromise]) as bigint;
      
      // Format the response
      const formattedBalance = this.formatBalance(balance);
      
      return `Address Balance Information:

- **Address:** ${args.address}
- **Shard:** ${args.shardId}
- **Balance:** ${formattedBalance}
- **Explorer Link:** ${this.formatExplorerLink(args.address)}

The balance was retrieved from the NIL blockchain at the current block.`;
    } catch (error) {
      console.error('Error checking balance:', error);
      
      if (error instanceof Error) {
        return `Failed to check address balance: ${error.message}`;
      }
      
      return 'An unknown error occurred while checking the balance.';
    }
  }

  supportsNetwork = (_network: Network) => true;
}

export const nilBalanceActionProvider = () => new NilBalanceActionProvider();