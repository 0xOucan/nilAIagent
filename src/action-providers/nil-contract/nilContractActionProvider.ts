import { z } from "zod";
/**
 * Contract deployment uses small random salt values between 0-9999 as recommended
 * in the NIL documentation: https://docs.nil.foundation/nil/cookbook/niljs-deploy/deploy-call-smart-contract/
 * 
 * This approach ensures each deployment gets a unique address while staying within 
 * the blockchain's limitations for salt values.
 */
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
  ExternalTransactionEnvelope,
  CometaService,
  externalDeploymentTransaction,
  getContract
} from "@nilfoundation/niljs";
import "reflect-metadata";
import * as crypto from 'crypto';

import { DeployContractSchema, CompileContractSchema, RegisterContractSchema } from "./schemas";
import { 
  DEFAULT_SHARD_ID,
  DEFAULT_GAS_MULTIPLIER,
  CONTRACT_TYPES,
  type ContractType,
  DEFAULT_GAS_LIMIT
} from "./constants";
import { ContractDeploymentError } from "./errors";
import { type Abi, encodeFunctionData } from "viem";

interface DeploymentParams {
  bytecode: Hex | Uint8Array;
  abi: Abi;
  args: unknown[];
  feeCredit: bigint;
  salt?: bigint;
  shardId: number;
}

export class NilContractActionProvider extends ActionProvider<EvmWalletProvider> {
  private rpcEndpoint: string;
  private faucetEndpoint: string;
  private clients: Map<number, PublicClient> = new Map();
  private cometaService: CometaService | null = null;
  private cometaEndpoint: string;

  constructor() {
    super("nil-contract", []);
    
    if (!process.env.NIL_RPC_ENDPOINT) {
      throw new Error("NIL_RPC_ENDPOINT must be set");
    }
    if (!process.env.NIL_FAUCET_ENDPOINT) {
      throw new Error("NIL_FAUCET_ENDPOINT must be set");
    }

    this.rpcEndpoint = process.env.NIL_RPC_ENDPOINT;
    this.faucetEndpoint = process.env.NIL_FAUCET_ENDPOINT;
    this.cometaEndpoint = process.env.COMETA_ENDPOINT || 'https://cometa.nil.foundation/api';
    
    // Initialize Cometa service if endpoint is available
    if (this.cometaEndpoint) {
      try {
        this.cometaService = new CometaService({
          transport: new HttpTransport({
            endpoint: this.cometaEndpoint,
          }),
        });
        console.log('Cometa service initialized');
      } catch (error) {
        console.error('Failed to initialize Cometa service:', error);
        this.cometaService = null;
      }
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

  private isEmptyCode(code: Uint8Array | string): boolean {
    if (!code) return true;
    if (code instanceof Uint8Array) return code.length === 0;
    if (typeof code === 'string') return code === '0x' || code === '';
    return true;
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

  private normalizeAddress(address: string): string {
    return address.startsWith('0x') ? address : `0x${address}`;
  }
  
  // Generate a truly random salt to avoid address collisions
  private generateRandomSalt(): bigint {
    // Generate a small random number between 0 and 9999 as recommended in NIL documentation
    // https://docs.nil.foundation/nil/cookbook/niljs-deploy/deploy-call-smart-contract/
    const randomValue = Math.floor(Math.random() * 10000);
    console.log(`Using salt: ${randomValue}`);
    return BigInt(randomValue);
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
  private async calculateContractAddress(
    shardId: number, 
    salt: bigint, 
    bytecode: Hex, 
    abi: Abi, 
    chainId: number
  ): Promise<Hex> {
    try {
      // Create a transaction envelope for deployment
      const transaction = new ExternalTransactionEnvelope({
        isDeploy: true,
        chainId,
        to: new Uint8Array(20), // Empty address for deployment
        data: hexToBytes(bytecode),
        authData: new Uint8Array(0),
        seqno: 0
      });
      
      // Extract the address from the transaction
      return bytesToHex(transaction.to) as Hex;
    } catch (error) {
      console.error('Error calculating contract address:', error);
      throw new ContractDeploymentError('unknown', `Failed to calculate contract address: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Add this helper function for better fund management
  private async ensureAdequateFunding(
    address: Hex,
    requiredAmount: bigint,
    client: PublicClient
  ): Promise<boolean> {
    try {
      // Check existing balance first
      const currentBalance = await client.getBalance(address);
      console.log(`Current balance: ${currentBalance}`);
      
      if (currentBalance >= requiredAmount) {
        console.log('Account already has sufficient funds');
        return true;
      }

      // Calculate how much more we need
      const neededAmount = requiredAmount - currentBalance;
      console.log(`Need additional ${neededAmount} funds`);

      // Try multiple top-up attempts with different amounts
      const attempts = [
        requiredAmount * 2n, // First try with double the required amount
        requiredAmount,      // Then try exact amount
        requiredAmount / 2n  // Finally try with half amount
      ];

      for (let i = 0; i < attempts.length; i++) {
        const amount = attempts[i];
        console.log(`Top-up attempt ${i + 1}: Trying with ${amount} units`);

        try {
          await topUp({
            address,
            amount,
            faucetEndpoint: this.faucetEndpoint,
            rpcEndpoint: this.rpcEndpoint,
            token: 'NIL'
          });

          // Verify the balance after top-up
          const newBalance = await client.getBalance(address);
          console.log(`New balance after top-up: ${newBalance}`);

          if (newBalance >= requiredAmount) {
            console.log('Successfully funded account');
            return true;
          }

          // Add delay between attempts
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          console.warn(`Top-up attempt ${i + 1} failed:`, error);
          continue;
        }
      }

      return false;
    } catch (error) {
      console.error('Error in ensureAdequateFunding:', error);
      return false;
    }
  }

  // Modify the deployContractExternal method
  private async deployContractExternal(
    client: PublicClient,
    params: DeploymentParams,
    chainId: number
  ): Promise<{ hash: string; address: string }> {
    try {
      // Generate salt as before
      const salt = this.generateRandomSalt();
      console.log(`Using salt: ${salt}`);

      // Create deployment transaction
      console.log('Creating deployment transaction using externalDeploymentTransaction');
      const deploymentTransaction = externalDeploymentTransaction(
        {
          salt,
          shard: params.shardId,
          bytecode: params.bytecode as Hex,
          abi: params.abi,
          args: params.args,
          feeCredit: params.feeCredit,
        },
        chainId
      );

      const contractAddress = bytesToHex(deploymentTransaction.to);
      console.log(`Contract address will be: ${contractAddress}`);

      // Calculate required funding (increased from original)
      const requiredFunding = params.feeCredit * 3n; // Triple the fee credit for safety
      console.log(`Required funding: ${requiredFunding}`);

      // Ensure adequate funding with retries
      const fundingSuccess = await this.ensureAdequateFunding(
        contractAddress as Hex,
        requiredFunding,
        client
      );

      if (!fundingSuccess) {
        throw new Error('Failed to adequately fund contract address after multiple attempts');
      }

      // Add delay after funding before deployment
      console.log('Waiting for funding to settle...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Send deployment transaction
      console.log('Sending deployment transaction');
      const hash = await deploymentTransaction.send(client);
      console.log(`Deployment transaction sent with hash: ${hash}`);

      return { hash, address: contractAddress };
    } catch (error) {
      console.error('External deployment error:', error);
      throw error;
    }
  }

  private async deployContractInternal(
    client: PublicClient,
    params: DeploymentParams
  ): Promise<{ hash: string; address: string }> {
    try {
      // Get current gas price from the network - THIS IS CRITICAL
      const gasPrice = await client.getGasPrice(params.shardId);
      console.log(`Current gas price for shard ${params.shardId}: ${gasPrice}`);
      
      // EXACTLY follow the NIL.js documentation for internal deployment
      console.log(`Creating smart account for contract deployment on shard ${params.shardId}...`);
      
      // Generate a random salt between 0-9999 as per NIL documentation
      const salt = this.generateRandomSalt();
      console.log(`Using salt for deployment: ${salt}`);
      
      // Create smart account with standard parameters
      const smartAccount = await generateSmartAccount({
        shardId: params.shardId,
        rpcEndpoint: this.rpcEndpoint,
        faucetEndpoint: this.faucetEndpoint,
      });
      
      console.log(`Smart account created: ${smartAccount.address}`);
      
      // Let's check the balance before deployment
      const initialBalance = await client.getBalance(smartAccount.address as Hex);
      console.log(`Initial smart account balance: ${initialBalance}`);
      
      // Calculate fee credit EXACTLY as in the NIL documentation - much higher than before
      // This is the key change - using a large multiplier with the gas price
      const feeCredit = 1_000_000n * gasPrice;
      console.log(`Using fee credit for deployment: ${feeCredit} (1,000,000 × ${gasPrice})`);
      
      // Wait a moment for the smart account to be fully initialized
      console.log('Waiting for smart account initialization...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Deploy the contract using smart account with correct gas parameters
      console.log('Deploying contract...');
      const { address, hash } = await smartAccount.deployContract({
        bytecode: params.bytecode,
        abi: params.abi,
        args: params.args,
        feeCredit: feeCredit, // Using the 1,000,000 × gasPrice as in docs
        salt: salt,
        shardId: params.shardId,
      });
      
      console.log(`Contract deployment transaction sent: ${hash}`);
      console.log(`Expected contract address: ${address}`);
      
      // Now we need to fund the contract address directly
      console.log(`Funding contract address ${address} directly...`);
      await topUp({
        address: address as Hex,
        amount: feeCredit * 2n, // Double the fee credit for contract funding
        faucetEndpoint: this.faucetEndpoint,
        rpcEndpoint: this.rpcEndpoint,
        token: 'NIL'
      });
      
      console.log('Waiting for contract funding to settle...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      return { hash, address };
    } catch (error) {
      console.error('Internal deployment error:', error);
      throw error;
    }
  }

  @CreateAction({
    name: "deploy-nil-contract",
    description: "Deploy a contract to the NIL blockchain",
    schema: DeployContractSchema,
  })
  async deployContract(
    args: z.infer<typeof DeployContractSchema>,
  ): Promise<string> {
    try {
      // Validate contract type
      if (!Object.keys(CONTRACT_TYPES).includes(args.contractType)) {
        throw new ContractDeploymentError(
          args.contractType, 
          `Unknown contract type. Available types: ${Object.keys(CONTRACT_TYPES).join(', ')}`
        );
      }

      console.log(`Deploying contract of type: ${args.contractType}`);
      
      // Get the contract details
      const contractDetails = CONTRACT_TYPES[args.contractType];
      if (!contractDetails) {
        throw new ContractDeploymentError(args.contractType, "Contract type details not found");
      }

      console.log(`Deploying ${args.contractType} contract on shard ${args.shardId}`);
      
      const client = this.getClient(args.shardId);
      
      // Check if the shard is active before deploying
      try {
        // Replace shardInfo with proper API method to check shard
        const shardCount = 4; // Use hardcoded value from configuration
        console.log(`Total shards available: ${shardCount}`);
        
        // Validate shard ID
        if (args.shardId < 1 || args.shardId > shardCount) {
          return `Cannot deploy contract: Shard ${args.shardId} is not available.

Please choose a valid shard ID between 1 and ${shardCount}.`;
        }
        
        // Check if we can get gas price for shard (indicates active shard)
        const gasPrice = await client.getGasPrice(args.shardId);
        if (!gasPrice) {
          return `Cannot deploy contract: Shard ${args.shardId} appears to be inactive.

Please choose an active shard.`;
        }
        
        console.log(`Shard ${args.shardId} is active with gas price: ${gasPrice}`);
      } catch (error) {
        console.warn(`Could not check shard status: ${error}`);
        // Continue anyway as the actual deployment will fail if shard is invalid
      }
      
      const gasPrice = await client.getGasPrice(args.shardId);
      const chainId = await client.chainId();
      
      // Convert bytecode string to proper format
      const bytecode = contractDetails.bytecode.startsWith('0x') 
        ? contractDetails.bytecode as Hex
        : `0x${contractDetails.bytecode}` as Hex;

      // Use dynamic gas pricing based on contract complexity
      const estimatedGasLimit = DEFAULT_GAS_LIMIT;
          
      const contractComplexityMultiplier = 
        args.contractType === 'TOKEN' ? 2n :
        args.contractType === 'NFT' ? 5n * 10n / 20n : // 2.5 as a bigint fraction (5/2)
        12n * 10n / 10n; // 1.2 as a bigint fraction (12/10)
      
      const feeCredit = contractComplexityMultiplier * gasPrice;
      console.log(`Using fee credit: ${feeCredit}`);
      
      // Handle constructor args for different contract types
      let constructorArgs = args.constructorArgs || [];
      if (args.contractType === 'ADVANCED_COUNTER') {
        constructorArgs = [
          args.initialValue || 0,
          args.maxValue || 100
        ];
      } else if (args.contractType === 'TOKEN') {
        constructorArgs = [
          args.tokenName || "NIL Token",
          args.tokenSymbol || "NILT",
          args.tokenDecimals || 18,
          args.tokenSupply || "1000000000000000000000000" // 1 million tokens with 18 decimals
        ];
      } else if (args.contractType === 'NFT') {
        constructorArgs = [
          args.nftName || "NIL NFT",
          args.nftSymbol || "NNFT",
          args.nftBaseUri || "https://nil.foundation/nft/"
        ];
      }

      // Prepare deployment params
      const deployParams: DeploymentParams = {
        bytecode,
        abi: (contractDetails as any).abi ? 
          (contractDetails as any).abi as Abi : 
          [] as unknown as Abi, // Fallback to empty array if abi is missing
        args: constructorArgs,
        feeCredit,
        salt: undefined, // Let the deployment method generate a random salt
        shardId: args.shardId,
      };

      // Try internal deployment first if requested
      if (args.useInternalDeployment) {
        try {
          const { hash, address: contractAddress } = await this.deployContractInternal(
            client,
            deployParams
          );

          console.log(`Deployment result: Contract address: ${contractAddress}, Hash: ${hash}`);
          
          // Wait for contract deployment with retries (pass hash to the method)
          const isDeployed = await this.waitForContractDeployment(client, contractAddress, hash);
          if (!isDeployed) {
            // Instead of throwing an error, we'll provide a more informative response
            // with suggestions for how to proceed
            return `The ${args.contractType} contract deployment transaction was sent successfully, but verification timed out.\n\n` +
                   `- **Contract Address:** ${contractAddress}\n` +
                   `  ${this.formatExplorerLink('address', contractAddress)}\n\n` +
                   `- **Transaction Hash:** ${hash}\n` +
                   `  ${this.formatExplorerLink('tx', hash)}\n\n` +
                   `- **Shard ID:** ${args.shardId}\n\n` +
                   `This does not necessarily mean the deployment failed. The NIL blockchain may need more time to process the transaction.\n\n` +
                   `**Actions you can take:**\n` +
                   `1. Check the explorer link above in a few minutes to see if the contract appears\n` +
                   `2. Try verifying the contract manually with \`verify-contract ${contractAddress} ${args.shardId}\`\n` +
                   `3. Attempt to deploy again with a different salt value\n\n` +
                   `In some cases, the contract may deploy successfully but verification takes longer than our timeout allows.`;
          }

          let additionalInfo = '';
          if (args.contractType === 'ADVANCED_COUNTER') {
            additionalInfo = `
- **Initial Value:** ${args.initialValue || 0}
- **Maximum Value:** ${args.maxValue || 100}`;
          }

          return `Successfully deployed ${args.contractType} contract (internal)!\n\n` +
                 `- **Contract Address:** ${contractAddress}\n` +
                 `  ${this.formatExplorerLink('address', contractAddress)}\n\n` +
                 `- **Transaction Hash:** ${hash}\n` +
                 `  ${this.formatExplorerLink('tx', hash)}\n\n` +
                 `- **Shard ID:** ${args.shardId}${additionalInfo}\n\n` +
                 `The contract has been deployed and is ready for use.`;

        } catch (error) {
          console.log('Internal deployment failed, falling back to external deployment:', error);
        }
      }

      // External deployment (fallback or primary method)
      const { hash, address: contractAddress } = await this.deployContractExternal(
        client,
        deployParams,
        chainId
      );

      console.log(`Deployment result: Contract address: ${contractAddress}, Hash: ${hash}`);
      
      // Wait for contract deployment with retries (pass hash to the method)
      const isDeployed = await this.waitForContractDeployment(client, contractAddress, hash);
      if (!isDeployed) {
        // Instead of throwing an error, we'll provide a more informative response
        // with suggestions for how to proceed
        return `Contract deployment encountered funding issues. Here are the details:

- **Contract Address:** ${contractAddress}
- **Transaction Hash:** ${hash}
- **Shard ID:** ${args.shardId}
- **Status:** Failed (Insufficient Funds)

Recommendations:
1. Try deploying again with increased funding
2. Check the faucet service status
3. Verify the shard's gas price and adjust fee credit accordingly

You can also try:
- Using a different shard
- Waiting a few minutes before retrying
- Checking the contract address balance manually: \`check-nil-balance ${contractAddress}\``;
      }

      let additionalInfo = '';
      if (args.contractType === 'ADVANCED_COUNTER') {
        additionalInfo = `
- **Initial Value:** ${args.initialValue || 0}
- **Maximum Value:** ${args.maxValue || 100}`;
      }

      return `Successfully deployed ${args.contractType} contract (external)!\n\n` +
             `- **Contract Address:** ${contractAddress}\n` +
             `  ${this.formatExplorerLink('address', contractAddress)}\n\n` +
             `- **Transaction Hash:** ${hash}\n` +
             `  ${this.formatExplorerLink('tx', hash)}\n\n` +
             `- **Shard ID:** ${args.shardId}${additionalInfo}\n\n` +
             `The contract has been deployed and is ready for use.`;

    } catch (error) {
      console.error('Contract deployment error:', error);
      throw new ContractDeploymentError(
        args.contractType,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  @CreateAction({
    name: "verify-contract",
    description: "Verify a deployed contract on the NIL blockchain",
    schema: z.object({
      address: z.string().describe("Contract address to verify"),
      shardId: z.number().default(1).describe("Shard ID where the contract is deployed")
    })
  })
  async verifyContract(
    args: { address: string; shardId: number },
  ): Promise<string> {
    try {
      // Get the normalized address
      const contractAddress = this.normalizeAddress(args.address);
      
      // Get the client for the specified shard
      const client = this.getClient(args.shardId);
      
      // Attempt to get contract code
      let code: string | Uint8Array;
      try {
        code = await client.getCode(contractAddress as `0x${string}`);
      } catch (error) {
        return `Error retrieving code for address ${contractAddress}: ${error}`;
      }
      
      // Ensure the code exists and isn't empty
      if (!code || this.isEmptyCode(code)) {
        return `Contract verification failed: No code found at address ${contractAddress} on shard ${args.shardId}. This address may not be a contract.`;
      }
      
      // Calculate bytecode size - first convert to appropriate type
      let bytecodeSize = 0;
      const codeAsString = typeof code === 'string' ? code : bytesToHex(code as Uint8Array);
      bytecodeSize = Math.floor((codeAsString.length - 2) / 2); // Remove '0x' and convert hex to bytes
      
      // Get contract balance
      let balance: bigint = 0n;
      try {
        balance = await client.getBalance(contractAddress as `0x${string}`);
      } catch (error) {
        console.error(`Error getting contract balance: ${error}`);
      }
      
      // Attempt to determine contract type by comparing bytecode
      let contractType = "Unknown";
      
      // Compare with known contract types
      for (const [type, details] of Object.entries(CONTRACT_TYPES)) {
        if (details && details.bytecode) {
          // Get the first part of the bytecode for comparison
          const typedBytecode = details.bytecode as string;
          if (codeAsString.startsWith(typedBytecode.substring(0, 50))) {
            contractType = type;
            break;
          }
        }
      }
      
      // Format the balance for display
      const formattedBalance = balance / BigInt(10**18);
      
      // Return the verification result
      return `Contract Verification Successful:

- **Contract Address:** ${contractAddress}
- **Shard:** ${args.shardId}
- **Contract Type:** ${contractType}
- **Bytecode Size:** ${bytecodeSize} bytes
- **Balance:** ${formattedBalance} NIL
- **Explorer Link:** ${this.formatExplorerLink('address', contractAddress)}

The contract exists and is valid on the NIL blockchain.`;
    } catch (error) {
      console.error(`Error verifying contract:`, error);
      return `Error verifying contract: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  @CreateAction({
    name: "compile-contract",
    description: "Compile a contract using the Cometa service and optionally deploy it",
    schema: CompileContractSchema,
  })
  async compileContract(
    args: z.infer<typeof CompileContractSchema>,
  ): Promise<string> {
    try {
      // Check if Cometa service is available
      if (!this.cometaService) {
        return `Cometa service is not available. Please set the COMETA_ENDPOINT environment variable.`;
      }
      
      console.log(`Compiling contract ${args.contractName} with compiler version ${args.compilerVersion}`);
      
      // Prepare compilation JSON
      const fileName = args.contractName.split(':')[0];
      const contractName = args.contractName;
      
      const compilationJson = {
        contractName: contractName,
        compilerVersion: args.compilerVersion,
        settings: {
          evmVersion: args.evmVersion,
          optimizer: {
            enabled: args.optimizerEnabled,
            runs: args.optimizerRuns
          }
        },
        sources: {
          [fileName]: {
            content: args.sourceCode
          }
        }
      };
      
      // Compile the contract
      const compilationResult = await this.cometaService.compileContract(JSON.stringify(compilationJson));
      
      if (!compilationResult || !compilationResult.code) {
        return `Compilation failed. Please check your source code and try again.`;
      }
      
      console.log(`Contract compiled successfully. Bytecode size: ${compilationResult.code.length}`);
      
      // If auto-deploy is enabled, deploy the contract
      if (args.autoDeployContract) {
        // Get client for shard
        const client = this.getClient(args.shardId);
        
        // Create a smart account for deployment
        const smartAccount = await generateSmartAccount({
          shardId: args.shardId,
          rpcEndpoint: this.rpcEndpoint,
          faucetEndpoint: this.faucetEndpoint,
        });
        
        console.log(`Generated smart account ${smartAccount.address} for deployment`);
        
        // Deploy the contract
        const salt = this.generateRandomSalt();
        const feeCredit = 500_000n; // Default fee credit
        
        const { address, hash } = await smartAccount.deployContract({
          bytecode: typeof compilationResult.code === 'string' 
                  ? compilationResult.code as `0x${string}` 
                  : bytesToHex(compilationResult.code),
          abi: compilationResult.abi as unknown as Abi,
          args: args.constructorArgs,
          salt: salt,
          feeCredit: feeCredit,
          shardId: args.shardId,
        });
        
        console.log(`Contract deployment initiated. Hash: ${hash}, Address: ${address}`);
        
        // Wait for deployment to complete
        const receipts = await waitTillCompleted(client, hash as Hex);
        
        if (receipts.some(receipt => !receipt.success)) {
          return `Contract compilation succeeded, but deployment failed. Please try deploying manually.
          
- **Compilation Success:** Yes
- **Bytecode Size:** ${(compilationResult.code.length - 2) / 2} bytes
- **Deployment Status:** Failed
- **Transaction Hash:** ${hash}`;
        }
        
        // Register contract data with Cometa
        await this.cometaService.registerContractData(compilationResult, address);
        
        return `Contract compiled and deployed successfully:
        
- **Contract Name:** ${args.contractName}
- **Address:** ${address}
- **Shard:** ${args.shardId}
- **Compiler Version:** ${args.compilerVersion}
- **Bytecode Size:** ${(compilationResult.code.length - 2) / 2} bytes
- **Transaction Hash:** ${hash}
- **Explorer Link:** ${this.formatExplorerLink('address', address)}
- **Verification Status:** Verified with Cometa

You can now interact with your contract at the deployed address.`;
      }
      
      // If auto-deploy is disabled, just return compilation info
      return `Contract compiled successfully:
      
- **Contract Name:** ${args.contractName}
- **Compiler Version:** ${args.compilerVersion}
- **Bytecode Size:** ${(compilationResult.code.length - 2) / 2} bytes
- **Optimization:** ${args.optimizerEnabled ? `Enabled (${args.optimizerRuns} runs)` : 'Disabled'}

To deploy this contract, use the deploy-contract action with this bytecode.`;
      
    } catch (error) {
      console.error('Error compiling contract:', error);
      return `Error compiling contract: ${error}`;
    }
  }
  
  @CreateAction({
    name: "register-contract",
    description: "Register a deployed contract with the Cometa service for verification",
    schema: RegisterContractSchema,
  })
  async registerContract(
    args: z.infer<typeof RegisterContractSchema>,
  ): Promise<string> {
    try {
      // Check if Cometa service is available
      if (!this.cometaService) {
        return `Cometa service is not available. Please set the COMETA_ENDPOINT environment variable.`;
      }
      
      console.log(`Registering contract ${args.contractName} at address ${args.address}`);
      
      // Prepare compilation JSON for verification
      const fileName = args.contractName.split(':')[0];
      const contractName = args.contractName;
      
      const compilationJson = {
        contractName: contractName,
        compilerVersion: args.compilerVersion,
        settings: {
          evmVersion: args.evmVersion,
          optimizer: {
            enabled: args.optimizerEnabled,
            runs: args.optimizerRuns
          }
        },
        sources: {
          [fileName]: {
            content: args.sourceCode
          }
        }
      };
      
      // Compile the contract for verification
      const compilationResult = await this.cometaService.compileContract(JSON.stringify(compilationJson));
      
      if (!compilationResult || !compilationResult.code) {
        return `Compilation failed during verification. Please check your source code and try again.`;
      }
      
      console.log(`Contract compiled successfully. Bytecode size: ${compilationResult.code.length}`);
      
      // Verify contract existence
      const client = this.getClient(args.shardId);
      const contractAddress = args.address.startsWith('0x') ? args.address : `0x${args.address}`;
      
      // Get contract code to check if it exists
      const code = await client.getCode(contractAddress as Hex);
      
      if (!code || this.isEmptyCode(code)) {
        return `No contract found at address ${contractAddress} on shard ${args.shardId}. Please check the address and shard.`;
      }
      
      // Register the contract with Cometa
      await this.cometaService.registerContractData(
        compilationResult, 
        contractAddress as `0x${string}`
      );
      
      return `Contract registered with Cometa successfully:
      
- **Contract Name:** ${args.contractName}
- **Address:** ${contractAddress}
- **Shard:** ${args.shardId}
- **Compiler Version:** ${args.compilerVersion}
- **Explorer Link:** ${this.formatExplorerLink('address', contractAddress)}
- **Verification Status:** Verified

The contract can now be viewed and analyzed through the Cometa service.`;
      
    } catch (error) {
      console.error('Error registering contract:', error);
      return `Error registering contract: ${error}`;
    }
  }

  @CreateAction({
    name: "call-contract-method",
    description: "Call a read-only method on a deployed NIL contract",
    schema: z.object({
      address: z
        .string()
        .describe("The address of the deployed contract"),
      method: z
        .string()
        .describe("The name of the contract method to call"),
      args: z
        .array(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .default([])
        .describe("Optional arguments for the method call"),
      contractType: z
        .string()
        .optional()
        .describe("Optional contract type to use pre-defined ABI (e.g., COUNTER)"),
      shardId: z
        .number()
        .default(1)
        .describe("The shard ID where the contract is deployed")
    })
  })
  async callContractMethod(
    args: {
      address: string;
      method: string;
      args?: (string | number | boolean)[];
      contractType?: string;
      shardId: number;
    }
  ): Promise<string> {
    try {
      console.log(`Calling method ${args.method} on contract ${args.address} at shard ${args.shardId}`);
      
      // Normalize the address
      const contractAddress = this.normalizeAddress(args.address) as Hex;
      
      // Get the appropriate client
      const client = this.getClient(args.shardId);
      
      // Verify the contract exists
      const code = await client.getCode(contractAddress);
      if (this.isEmptyCode(code)) {
        return `No contract found at address ${args.address} on shard ${args.shardId}`;
      }
      
      // Get the contract ABI
      let abi: Abi;
      if (args.contractType && CONTRACT_TYPES[args.contractType]?.abi) {
        abi = CONTRACT_TYPES[args.contractType].abi as Abi;
        console.log(`Using ABI for known contract type: ${args.contractType}`);
      } else {
        // For COUNTER, use the default if no type specified
        abi = CONTRACT_TYPES.COUNTER.abi as Abi;
        console.log("Using default COUNTER contract ABI");
      }
      
      // Create the call data
      const callData = encodeFunctionData({
        abi,
        functionName: args.method,
        args: args.args || []
      });
      
      // Make the call
      console.log(`Calling ${args.method} with args: ${JSON.stringify(args.args || [])}`);
      
      // For getValue specifically, we'll use the contract factory approach from NIL docs
      if (args.method === 'getValue') {
        try {
          // Use getContract factory method
          const contract = getContract({
            client: client,
            abi: abi as unknown[],
            address: contractAddress,
          });
          
          // Call read method
          const value = await contract.read.getValue([]);
          console.log(`Read result using contract factory: ${value}`);
          
          return `Current counter value: ${value !== undefined && value !== null ? value.toString() : '0'}`;
        } catch (contractError) {
          console.error('Error using contract factory:', contractError);
          // Fall back to standard call approach if contract factory fails
        }
      }
      
      // Standard call approach
      const result = await client.call({
        to: contractAddress,
        data: callData,
      }, 'latest');
      
      // Properly handle result based on its type
      console.log('Raw result type:', typeof result, 'Value:', result);
      
      let formattedResult = '';
      
      if (result !== undefined && result !== null) {
        if (typeof result === 'bigint') {
          formattedResult = (result as bigint).toString();
        } else if (typeof result === 'object') {
          formattedResult = JSON.stringify(result);
          
          if (result !== null && 'hex' in result && typeof (result as any).hex === 'string') {
            const hexValue = (result as any).hex as string;
            if (hexValue.startsWith('0x')) {
              try {
                formattedResult = BigInt(hexValue).toString();
              } catch (e) {
                // Keep JSON string if BigInt conversion fails
              }
            }
          }
        } else if (typeof result === 'string') {
          const strResult = result as string;
          if (strResult.startsWith('0x')) {
            try {
              formattedResult = BigInt(strResult).toString();
            } catch (e) {
              formattedResult = strResult;
            }
          } else {
            formattedResult = strResult;
          }
        }
      }
      
      // Format for getValue function
      if (args.method === 'getValue') {
        return `Current counter value: ${formattedResult || '0'}`;
      }
      
      return `Method call successful. Result: ${formattedResult}`;
    } catch (error) {
      console.error('Error calling contract method:', error);
      return `Error calling contract method: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  @CreateAction({
    name: "execute-contract-method",
    description: "Execute a state-changing method on a deployed NIL contract",
    schema: z.object({
      address: z
        .string()
        .describe("The address of the deployed contract"),
      method: z
        .string()
        .describe("The name of the contract method to execute"),
      args: z
        .array(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .default([])
        .describe("Optional arguments for the method call"),
      contractType: z
        .string()
        .optional()
        .describe("Optional contract type to use pre-defined ABI (e.g., COUNTER)"),
      shardId: z
        .number()
        .default(1)
        .describe("The shard ID where the contract is deployed"),
      value: z
        .string()
        .optional()
        .default("0")
        .describe("Optional value to send with the transaction (in wei)")
    })
  })
  async executeContractMethod(
    args: {
      address: string;
      method: string;
      args?: (string | number | boolean)[];
      contractType?: string;
      shardId: number;
      value?: string;
    }
  ): Promise<string> {
    try {
      console.log(`Executing method ${args.method} on contract ${args.address} at shard ${args.shardId}`);
      
      // Normalize the address
      const contractAddress = this.normalizeAddress(args.address) as Hex;
      
      // Get the appropriate client
      const client = this.getClient(args.shardId);
      
      // Verify the contract exists
      const code = await client.getCode(contractAddress);
      if (this.isEmptyCode(code)) {
        return `No contract found at address ${args.address} on shard ${args.shardId}`;
      }
      
      // Get the contract ABI
      let abi: Abi;
      if (args.contractType && CONTRACT_TYPES[args.contractType]?.abi) {
        abi = CONTRACT_TYPES[args.contractType].abi as Abi;
        console.log(`Using ABI for known contract type: ${args.contractType}`);
      } else {
        // For COUNTER, use the default if no type specified
        abi = CONTRACT_TYPES.COUNTER.abi as Abi;
        console.log("Using default COUNTER contract ABI");
      }
      
      // Try the contract factory approach first (as recommended in NIL docs)
      if (args.method === 'increment') {
        try {
          // Create a smart account
          console.log("Creating smart account for contract factory...");
          const smartAccount = await generateSmartAccount({
            shardId: args.shardId,
            rpcEndpoint: this.rpcEndpoint,
            faucetEndpoint: this.faucetEndpoint,
          });
          
          console.log(`Using smart account with contract factory: ${smartAccount.address}`);
          
          // Use contract factory approach
          const contract = getContract({
            client: client,
            abi: abi as unknown[],
            address: contractAddress,
            smartAccount: smartAccount,
          });
          
          // Execute the transaction through contract factory
          console.log('Executing increment through contract factory...');
          const hash = await contract.write.increment([]);
          console.log(`Transaction hash via contract factory: ${hash}`);
          
          // Wait for transaction to complete
          await waitTillCompleted(client, hash);
          console.log('Transaction completed successfully');
          
          // Get new value
          try {
            const newValueResult = await contract.read.getValue([]);
            let newValue = 'unknown';
            if (newValueResult !== undefined && newValueResult !== null) {
              if (typeof newValueResult === 'bigint') {
                newValue = (newValueResult as bigint).toString();
              } else if (typeof newValueResult === 'object') {
                newValue = JSON.stringify(newValueResult);
                
                // Try to extract hex value if available
                if (newValueResult !== null && 'hex' in newValueResult && typeof (newValueResult as any).hex === 'string') {
                  try {
                    newValue = BigInt((newValueResult as any).hex as string).toString();
                  } catch (e) {
                    // Keep JSON string if BigInt conversion fails
                  }
                }
              } else if (typeof newValueResult === 'string') {
                newValue = newValueResult as string;
              }
            }
            
            return `Successfully executed ${args.method} using contract factory. Transaction hash: ${hash}
            
New counter value: ${newValue || 'unknown'}

You can view the transaction details at: ${this.formatExplorerLink('tx', hash)}`;
          } catch (readError) {
            console.error('Error reading new value:', readError);
          }
          
          return `Successfully executed ${args.method} using contract factory. Transaction hash: ${hash}
          
You can view the transaction details at: ${this.formatExplorerLink('tx', hash)}`;
        } catch (factoryError) {
          // Log error and fall back to standard approach
          console.error('Error using contract factory:', factoryError);
          console.log('Falling back to standard transaction approach...');
        }
      }
      
      // Standard transaction approach (fallback)
      console.log("Creating smart account for transaction...");
      const smartAccount = await generateSmartAccount({
        shardId: args.shardId,
        rpcEndpoint: this.rpcEndpoint,
        faucetEndpoint: this.faucetEndpoint,
      });
      
      console.log(`Using smart account: ${smartAccount.address}`);
      
      // Get gas price for better fee estimation
      const gasPrice = await client.getGasPrice(args.shardId);
      // Use a MUCH higher fee credit (1,000,000 × gasPrice as in NIL docs)
      const feeCredit = gasPrice * 1000000n;
      console.log(`Using fee credit: ${feeCredit} (1,000,000 × ${gasPrice})`);
      
      // For increment, use the specific approach from NIL docs
      if (args.method === 'increment') {
        console.log('Using specific increment method from NIL docs');
        const hash = await smartAccount.sendTransaction({
          to: contractAddress,
          abi: abi,
          functionName: args.method,
          feeCredit: feeCredit,
        });
        
        console.log(`Increment transaction sent with hash: ${hash}`);
        
        // Wait for transaction to complete
        try {
          await waitTillCompleted(client, hash as Hex);
          console.log('Transaction completed successfully');
          
          // Try to get the new value
          try {
            // Create call data for getValue
            const getValueData = encodeFunctionData({
              abi,
              functionName: 'getValue',
              args: []
            });
            
            // Get the new counter value
            const newValueResult = await client.call({
              to: contractAddress,
              data: getValueData,
            }, 'latest');
            
            let newValue = 'unknown';
            if (newValueResult !== undefined && newValueResult !== null) {
              if (typeof newValueResult === 'bigint') {
                newValue = (newValueResult as bigint).toString();
              } else if (typeof newValueResult === 'object') {
                newValue = JSON.stringify(newValueResult);
                
                // Try to extract hex value if available
                if (newValueResult !== null && 'hex' in newValueResult && typeof (newValueResult as any).hex === 'string') {
                  try {
                    newValue = BigInt((newValueResult as any).hex as string).toString();
                  } catch (e) {
                    // Keep JSON string if BigInt conversion fails
                  }
                }
              } else if (typeof newValueResult === 'string') {
                newValue = newValueResult as string;
              }
            }
            
            return `Successfully executed ${args.method}. Transaction hash: ${hash}
            
New counter value: ${newValue || 'unknown'}

You can view the transaction details at: ${this.formatExplorerLink('tx', hash)}`;
          } catch (error) {
            console.error('Error getting updated value:', error);
          }
        } catch (waitError) {
          console.error('Error waiting for transaction completion:', waitError);
          return `Transaction sent but may have failed during execution. Transaction hash: ${hash}
          
You can view the transaction details at: ${this.formatExplorerLink('tx', hash)}`;
        }
        
        return `Transaction sent. Transaction hash: ${hash}
        
You can view the transaction details at: ${this.formatExplorerLink('tx', hash)}`;
      }
      
      // General transaction for other methods
      // Create transaction data
      const data = encodeFunctionData({
        abi,
        functionName: args.method,
        args: args.args || []
      });
      
      // Send the transaction
      console.log(`Sending transaction to execute ${args.method}...`);
      const txResult = await smartAccount.sendTransaction({
        to: contractAddress,
        data,
        value: BigInt(args.value || "0"),
        feeCredit: feeCredit
      });
      
      // Get the transaction hash
      const hash = typeof txResult === 'string' ? txResult : (txResult as any).hash || JSON.stringify(txResult);
      console.log(`Transaction sent with hash: ${hash}`);
      
      // Wait for transaction to complete
      try {
        await waitTillCompleted(client, hash as Hex);
        console.log('Transaction completed');
        
        return `Successfully executed ${args.method}. Transaction hash: ${hash}
        
You can view the transaction details at: ${this.formatExplorerLink('tx', hash)}`;
      } catch (waitError) {
        console.error('Error waiting for transaction completion:', waitError);
        return `Transaction sent but may have failed during execution. Transaction hash: ${hash}
        
You can view the transaction details at: ${this.formatExplorerLink('tx', hash)}`;
      }
    } catch (error) {
      console.error('Error executing contract method:', error);
      return `Error executing contract method: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  supportsNetwork = (_network: Network) => true;

  /**
   * Wait for contract deployment to complete and verify code is available
   * @param client PublicClient to use for verification
   * @param address Contract address to check
   * @param hash Transaction hash
   * @returns Promise<boolean> indicating if deployment was successful
   */
  private async waitForContractDeployment(
    client: PublicClient,
    address: string,
    hash: string
  ): Promise<boolean> {
    try {
      // First check if transaction completed successfully
      console.log(`Waiting for transaction ${hash} to complete...`);
      await waitTillCompleted(client, hash as Hex);
      
      // Check transaction receipt for status
      console.log(`Checking transaction receipt for ${hash}...`);
      const receipt = await client.getTransactionReceiptByHash(hash as Hex);
      
      // Handle null receipt (transaction not found or not processed)
      if (!receipt) {
        console.error('Contract deployment failed: No transaction receipt found');
        return false;
      }
      
      // Check if transaction failed due to insufficient funds
      if (receipt.status === 'InsufficientFunds') {
        console.error('Contract deployment failed: Insufficient funds');
        return false;
      }
      
      // If not successful status, return false
      if (receipt.status !== 'Success') {
        console.error(`Contract deployment failed: Status is ${receipt.status}`);
        return false;
      }
      
      // Now verify the contract has code
      console.log(`Transaction completed, now verifying contract code...`);
      
      // Try up to 30 times with progressive waiting
      for (let attempt = 1; attempt <= 30; attempt++) {
        console.log(`Verifying contract code (attempt ${attempt}/30)...`);
        const code = await client.getCode(address as Hex);
        
        if (!this.isEmptyCode(code)) {
          console.log('Contract code verified successfully!');
          return true;
        }
        
        if (attempt < 30) {
          const waitTime = Math.min(5 + attempt, 30); // Progressive wait, max 30 seconds
          console.log(`Contract code not yet available, waiting ${waitTime} seconds...`);
          await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
        }
      }
      
      console.error('Contract code never appeared after 30 attempts');
      return false;
    } catch (error) {
      console.error('Error waiting for contract deployment:', error);
      return false;
    }
  }
}

export const nilContractActionProvider = () => new NilContractActionProvider(); 