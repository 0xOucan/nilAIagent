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
  topUp,
  type Hex
} from "@nilfoundation/niljs";
import "reflect-metadata";

import {
  CreateSmartAccountSchema,
  TopUpAccountSchema,
} from "./schemas";
import { 
  DEFAULT_SHARD_ID, 
  SUPPORTED_TOKENS, 
  TOKEN_MINIMUM_AMOUNTS,
  type SupportedToken 
} from "./constants";
import { SmartAccountCreationError, TopUpError } from "./errors";

export class NilAccountActionProvider extends ActionProvider<EvmWalletProvider> {
  private rpcEndpoint: string;
  private faucetEndpoint: string;
  private client: PublicClient;

  constructor() {
    super("nil-account", []);
    
    if (!process.env.NIL_RPC_ENDPOINT || !process.env.NIL_FAUCET_ENDPOINT) {
      throw new Error("NIL_RPC_ENDPOINT and NIL_FAUCET_ENDPOINT must be set in environment variables");
    }

    this.rpcEndpoint = process.env.NIL_RPC_ENDPOINT;
    this.faucetEndpoint = process.env.NIL_FAUCET_ENDPOINT;
    
    // Initialize client once in constructor
    this.client = new PublicClient({
      transport: new HttpTransport({
        endpoint: this.rpcEndpoint,
      }),
      shardId: DEFAULT_SHARD_ID,
    });
  }

  private ensureHexAddress(address: string): Hex {
    try {
      // Remove any whitespace
      address = address.trim();
      // Ensure address starts with 0x
      const formattedAddress = address.startsWith('0x') ? address : `0x${address}`;
      // Validate address format
      if (!/^0x[0-9a-fA-F]{40}$/.test(formattedAddress)) {
        throw new Error(`Invalid address format: ${address}`);
      }
      return formattedAddress.toLowerCase() as Hex;
    } catch (error) {
      throw new Error(`Invalid address: ${address} - ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async topUpToken(
    address: string,
    token: SupportedToken,
    amount: string
  ): Promise<boolean> {
    try {
      const hexAddress = this.ensureHexAddress(address);
      
      // Verify the address exists before attempting top-up
      const exists = await this.client.getBalance(hexAddress).catch(() => null);
      if (exists === null) {
        console.error(`Address ${address} not found or not accessible`);
        return false;
      }

      await topUp({
        address: hexAddress,
        faucetEndpoint: this.faucetEndpoint,
        rpcEndpoint: this.rpcEndpoint,
        token: token,
        amount: BigInt(amount),
      });

      // Verify the top-up was successful
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for transaction to process
      const newBalance = await this.getAccountBalances(address);
      if (!newBalance) {
        console.error(`Failed to verify balance after top-up for ${token}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to top up ${token}:`, error);
      return false;
    }
  }

  private async getAccountBalances(address: string) {
    try {
      const hexAddress = this.ensureHexAddress(address);
      
      const [tokenBalances, nativeBalance] = await Promise.all([
        this.client.getTokens(hexAddress, "latest").catch(() => null),
        this.client.getBalance(hexAddress).catch(() => null)
      ]);

      if (nativeBalance === null) {
        console.error(`Failed to get native balance for ${address}`);
        return null;
      }

      return {
        tokens: tokenBalances || {},
        native: nativeBalance
      };
    } catch (error) {
      console.error("Failed to get balances:", error);
      return null;
    }
  }

  @CreateAction({
    name: "check-nil-balance",
    description: "Check the balance of a NIL address",
    schema: z.object({
      address: z.string().describe("The address to check")
    }).strip(),
  })
  async checkBalance(
    _walletProvider: EvmWalletProvider,
    args: { address: string }
  ): Promise<string> {
    try {
      const balances = await this.getAccountBalances(args.address);
      if (!balances) {
        return `Unable to fetch balances for address: ${args.address}`;
      }

      let response = `Balances for ${args.address}:\n`;
      response += `Native: ${balances.native.toString()} NIL\n`;
      if (Object.keys(balances.tokens).length > 0) {
        response += `Tokens:\n${JSON.stringify(balances.tokens, null, 2)}`;
      } else {
        response += `No token balances found`;
      }
      return response;

    } catch (error) {
      return `Error checking balance: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  @CreateAction({
    name: "create-nil-account",
    description: "Create a new Nil smart account and get its address",
    schema: CreateSmartAccountSchema,
  })
  async createSmartAccount(): Promise<string> {
    try {
      const client = new PublicClient({
        transport: new HttpTransport({
          endpoint: this.rpcEndpoint,
        }),
        shardId: DEFAULT_SHARD_ID,
      });

      const smartAccount = await generateSmartAccount({
        shardId: DEFAULT_SHARD_ID,
        rpcEndpoint: this.rpcEndpoint,
        faucetEndpoint: this.faucetEndpoint,
      });

      const balance = await client.getBalance(smartAccount.address);

      return `Successfully created smart account!\n` +
             `Address: ${smartAccount.address}\n` +
             `Initial Balance: ${balance.toString()} NIL`;

    } catch (error) {
      throw new SmartAccountCreationError(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  @CreateAction({
    name: "top-up-nil-account",
    description: "Top up a Nil smart account with one or more tokens from faucet (NIL, BTC, ETH, USDT). Uses minimum required amounts per token.",
    schema: TopUpAccountSchema,
  })
  async topUpAccount(
    _walletProvider: EvmWalletProvider,
    args: z.infer<typeof TopUpAccountSchema>
  ): Promise<string> {
    try {
      let targetAddress: string;
      let response = "";

      // Create new account if no address is provided
      if (!args.address) {
        const smartAccount = await generateSmartAccount({
          shardId: DEFAULT_SHARD_ID,
          rpcEndpoint: this.rpcEndpoint,
          faucetEndpoint: this.faucetEndpoint,
        });
        targetAddress = smartAccount.address;
        response += `Created new smart account: ${targetAddress}\n\n`;
      } else {
        targetAddress = args.address;
        response += `Using existing account: ${targetAddress}\n\n`;
      }

      // Get initial balances
      const balanceBefore = await this.getAccountBalances(targetAddress);
      if (balanceBefore) {
        response += `Initial balances:\n`;
        response += `Native: ${balanceBefore.native.toString()} NIL\n`;
        response += `Tokens: ${JSON.stringify(balanceBefore.tokens, null, 2)}\n\n`;
      }

      // Process each token top-up
      for (const token of args.tokens) {
        const tokenKey = token as SupportedToken;
        const amount = TOKEN_MINIMUM_AMOUNTS[tokenKey];
        
        // Add delay between requests
        if (args.tokens.indexOf(token) > 0) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        const success = await this.topUpToken(targetAddress, tokenKey, amount);
        const formattedAmount = tokenKey === 'NIL' ? '0.0001' :
                               tokenKey === 'USDT' ? '1.0' :
                               tokenKey === 'BTC' ? '1.0' :
                               tokenKey === 'ETH' ? '1.0' : amount;

        response += success 
          ? `✓ Successfully topped up ${formattedAmount} ${tokenKey}\n`
          : `✗ Failed to top up ${tokenKey}\n`;
      }

      // Get final balances
      const balanceAfter = await this.getAccountBalances(targetAddress);
      if (balanceAfter) {
        response += `\nFinal balances:\n`;
        response += `Native: ${balanceAfter.native.toString()} NIL\n`;
        response += `Tokens: ${JSON.stringify(balanceAfter.tokens, null, 2)}`;
      }

      return response;

    } catch (error) {
      throw new TopUpError(
        args.tokens.join(", "), 
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  @CreateAction({
    name: "list-available-tokens",
    description: "List all available tokens that can be used for top-up with their minimum amounts",
    schema: z.object({}).strip(),
  })
  async listAvailableTokens(): Promise<string> {
    const tokenList = Object.entries(SUPPORTED_TOKENS)
      .map(([symbol, address]) => {
        const tokenKey = symbol as SupportedToken;
        const minAmount = tokenKey === 'NIL' ? '0.0001' :
                         tokenKey === 'USDT' ? '1.0' :
                         tokenKey === 'BTC' ? '1.0' :
                         tokenKey === 'ETH' ? '1.0' : TOKEN_MINIMUM_AMOUNTS[tokenKey];
        
        return `${symbol}: ${address}\n  Minimum amount: ${minAmount} ${symbol}`;
      })
      .join('\n\n');

    return `Available tokens for top-up:\n${tokenList}`;
  }

  // This provider doesn't need network support since it's not EVM-based
  supportsNetwork = (_network: Network) => true;
}

export const nilAccountActionProvider = () => new NilAccountActionProvider(); 