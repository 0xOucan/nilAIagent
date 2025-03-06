import { generateSmartAccount, PublicClient, HttpTransport, waitTillCompleted, bytesToHex } from "@nilfoundation/niljs";
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { Abi, Hex } from 'viem';
import * as crypto from 'crypto';

// Configuration
const RPC_ENDPOINT = process.env.NIL_RPC_URL || process.env.NIL_RPC_ENDPOINT || 'https://rpc.nil.foundation';
const FAUCET_ENDPOINT = process.env.NIL_FAUCET_URL || process.env.NIL_FAUCET_ENDPOINT || 'https://faucet.nil.foundation';
const RETAILER_SHARD_ID = 1; // Default shard ID for retailer
const MANUFACTURER_SHARD_ID = 1; // Default shard ID for manufacturer - use same shard for simplicity

// Since generateKeyPair isn't available in NIL.js, we'll implement our own
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

async function main() {
  try {
    console.log("Starting Supply Chain contracts deployment...");
    
    // Step 1: Compile the contracts
    console.log("Compiling Retailer.sol and Manufacturer.sol...");
    
    // Create temp directory for solc input/output if it doesn't exist
    const tempDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Create a package.json for solc remappings
    const packageJson = {
      name: "nil-contracts-compilation",
      dependencies: {
        "@nilfoundation/smart-contracts": "^0.1.0"
      }
    };
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2));

    // Install dependencies in temp directory
    console.log('Installing dependencies...');
    try {
      execSync('npm install', { cwd: tempDir });
    } catch (error) {
      console.error('Error installing dependencies:', error);
      console.log('Proceeding with compilation anyway...');
    }

    // Set up remappings for solc
    const remappings = [
      `@nilfoundation/=node_modules/@nilfoundation/`
    ].join(',');
    
    // Path to contract files
    const retailerPath = path.join(__dirname, '../contracts/Retailer.sol');
    const manufacturerPath = path.join(__dirname, '../contracts/Manufacturer.sol');
    
    // Compile the contracts
    const retailerOutputPath = path.join(tempDir, 'Retailer.json');
    const manufacturerOutputPath = path.join(tempDir, 'Manufacturer.json');
    
    try {
      execSync(`solc --optimize --optimize-runs=200 --combined-json abi,bin --allow-paths ${tempDir}/node_modules @remappings=${remappings} ${retailerPath} > ${retailerOutputPath}`);
      console.log("Retailer compilation successful!");
    } catch (error) {
      console.error("Error compiling Retailer contract:", error);
      return;
    }
    
    try {
      execSync(`solc --optimize --optimize-runs=200 --combined-json abi,bin --allow-paths ${tempDir}/node_modules @remappings=${remappings} ${manufacturerPath} > ${manufacturerOutputPath}`);
      console.log("Manufacturer compilation successful!");
    } catch (error) {
      console.error("Error compiling Manufacturer contract:", error);
      return;
    }
    
    // Read the compiled outputs
    const retailerOutput = JSON.parse(fs.readFileSync(retailerOutputPath, 'utf8'));
    const manufacturerOutput = JSON.parse(fs.readFileSync(manufacturerOutputPath, 'utf8'));
    
    // Find the contract keys
    const retailerKey = Object.keys(retailerOutput.contracts).find(
      key => key.endsWith('Retailer.sol:Retailer')
    );
    const manufacturerKey = Object.keys(manufacturerOutput.contracts).find(
      key => key.endsWith('Manufacturer.sol:Manufacturer')
    );
    
    if (!retailerKey || !manufacturerKey) {
      console.error("Could not find compiled contracts in output");
      return;
    }
    
    // Extract bytecode and ABI
    const retailerContract = retailerOutput.contracts[retailerKey];
    const manufacturerContract = manufacturerOutput.contracts[manufacturerKey];
    
    const retailerBytecode = `0x${retailerContract.bin}` as Hex;
    const manufacturerBytecode = `0x${manufacturerContract.bin}` as Hex;
    const retailerAbi = JSON.parse(retailerContract.abi) as Abi;
    const manufacturerAbi = JSON.parse(manufacturerContract.abi) as Abi;
    
    console.log("Compilation successful!");
    console.log(`Retailer bytecode length: ${retailerBytecode.length}`);
    console.log(`Manufacturer bytecode length: ${manufacturerBytecode.length}`);
    
    // Step 2: Deploy the Retailer contract
    console.log(`Deploying Retailer contract to shard ${RETAILER_SHARD_ID}...`);
    
    // Create a client for the retailer shard
    const retailerClient = new PublicClient({
      transport: new HttpTransport({
        endpoint: RPC_ENDPOINT,
      }),
      shardId: RETAILER_SHARD_ID,
    });
    
    // Create a smart account for deploying the retailer contract
    const retailerAccount = await generateSmartAccount({
      shardId: RETAILER_SHARD_ID,
      rpcEndpoint: RPC_ENDPOINT,
      faucetEndpoint: FAUCET_ENDPOINT,
    });
    
    console.log(`Using smart account for Retailer: ${retailerAccount.address}`);
    
    // Check balance before deployment
    const retailerBalanceBefore = await retailerClient.getBalance(retailerAccount.address as `0x${string}`);
    console.log(`Initial retailer account balance: ${retailerBalanceBefore}`);
    
    // Generate a random salt for retailer
    const retailerSalt = BigInt(Math.floor(Math.random() * 10000));
    console.log(`Using salt for Retailer: ${retailerSalt}`);
    
    // Get gas price for better fee estimation
    const retailerGasPrice = await retailerClient.getGasPrice(RETAILER_SHARD_ID);
    const retailerFeeCredit = 1_000_000n * retailerGasPrice;
    
    // Deploy the Retailer contract
    const retailerDeployResult = await retailerAccount.deployContract({
      bytecode: retailerBytecode,
      abi: retailerAbi,
      args: [], // No constructor arguments for Retailer
      salt: retailerSalt,
      feeCredit: retailerFeeCredit,
      shardId: RETAILER_SHARD_ID,
    });
    
    // Extract address and hash from deployment result
    const retailerAddress = retailerDeployResult.address as string;
    const retailerHash = retailerDeployResult.hash as string;
    
    console.log(`\nRetailer deployment initiated!`);
    console.log(`Retailer address: ${retailerAddress}`);
    console.log(`Retailer transaction hash: ${retailerHash}`);
    
    // Wait for retailer deployment to be confirmed
    console.log(`\nWaiting for Retailer deployment confirmation...`);
    
    try {
      await waitTillCompleted(retailerClient, retailerHash as `0x${string}`);
      console.log("Retailer transaction processing completed!");
    } catch (error) {
      console.log("Error waiting for Retailer transaction:", error);
      return;
    }
    
    // Wait a bit longer as the code may not be immediately available
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Verify retailer contract code exists
    let retailerRetries = 0;
    let isRetailerDeployed = false;
    
    while (retailerRetries < 10 && !isRetailerDeployed) {
      try {
        const code = await retailerClient.getCode(retailerAddress as `0x${string}`);
        if (code && code.length > 2) {
          isRetailerDeployed = true;
          break;
        }
      } catch (error) {
        console.log(`Attempt ${retailerRetries + 1}: Retailer contract not yet deployed...`);
      }
      
      retailerRetries++;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    if (!isRetailerDeployed) {
      console.error("Retailer contract deployment failed or timed out");
      return;
    }
    
    console.log("Retailer contract successfully deployed!");
    
    // Step 3: Deploy the Manufacturer contract
    console.log(`\nDeploying Manufacturer contract to shard ${MANUFACTURER_SHARD_ID}...`);
    
    // Create a client for the manufacturer shard
    const manufacturerClient = new PublicClient({
      transport: new HttpTransport({
        endpoint: RPC_ENDPOINT,
      }),
      shardId: MANUFACTURER_SHARD_ID,
    });
    
    // Create a smart account for deploying the manufacturer contract
    const manufacturerAccount = await generateSmartAccount({
      shardId: MANUFACTURER_SHARD_ID,
      rpcEndpoint: RPC_ENDPOINT,
      faucetEndpoint: FAUCET_ENDPOINT,
    });
    
    console.log(`Using smart account for Manufacturer: ${manufacturerAccount.address}`);
    
    // Generate a key pair for signature verification
    const keyPair = generateKeyPair();
    const pubkey = keyPair.publicKey;
    const pubkeyHex = bytesToHex(pubkey);
    
    console.log(`Generated public key for Manufacturer: ${pubkeyHex}`);
    
    // Get gas price for better fee estimation
    const manufacturerGasPrice = await manufacturerClient.getGasPrice(MANUFACTURER_SHARD_ID);
    const manufacturerFeeCredit = 1_000_000n * manufacturerGasPrice;
    
    // Generate a random salt for manufacturer
    const manufacturerSalt = BigInt(Math.floor(Math.random() * 10000));
    console.log(`Using salt for Manufacturer: ${manufacturerSalt}`);
    
    // Deploy the Manufacturer contract with constructor arguments
    const manufacturerDeployResult = await manufacturerAccount.deployContract({
      bytecode: manufacturerBytecode,
      abi: manufacturerAbi,
      args: [pubkey, retailerAddress], // Pass pubkey and retailer address
      salt: manufacturerSalt,
      feeCredit: manufacturerFeeCredit,
      shardId: MANUFACTURER_SHARD_ID,
    });
    
    // Extract address and hash from deployment result
    const manufacturerAddress = manufacturerDeployResult.address as string;
    const manufacturerHash = manufacturerDeployResult.hash as string;
    
    console.log(`\nManufacturer deployment initiated!`);
    console.log(`Manufacturer address: ${manufacturerAddress}`);
    console.log(`Manufacturer transaction hash: ${manufacturerHash}`);
    
    // Wait for manufacturer deployment to be confirmed
    console.log(`\nWaiting for Manufacturer deployment confirmation...`);
    
    try {
      await waitTillCompleted(manufacturerClient, manufacturerHash as `0x${string}`);
      console.log("Manufacturer transaction processing completed!");
    } catch (error) {
      console.log("Error waiting for Manufacturer transaction:", error);
      return;
    }
    
    // Wait a bit longer as the code may not be immediately available
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Verify manufacturer contract code exists
    let manufacturerRetries = 0;
    let isManufacturerDeployed = false;
    
    while (manufacturerRetries < 10 && !isManufacturerDeployed) {
      try {
        const code = await manufacturerClient.getCode(manufacturerAddress as `0x${string}`);
        if (code && code.length > 2) {
          isManufacturerDeployed = true;
          break;
        }
      } catch (error) {
        console.log(`Attempt ${manufacturerRetries + 1}: Manufacturer contract not yet deployed...`);
      }
      
      manufacturerRetries++;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    if (!isManufacturerDeployed) {
      console.error("Manufacturer contract deployment failed or timed out");
      return;
    }
    
    console.log("\nManufacturer contract successfully deployed!");
    
    // Save deployment info to file
    const deploymentInfo = {
      retailer: {
        address: retailerAddress,
        hash: retailerHash,
        shardId: RETAILER_SHARD_ID,
        abi: retailerAbi,
        bytecode: retailerBytecode,
      },
      manufacturer: {
        address: manufacturerAddress,
        hash: manufacturerHash,
        shardId: MANUFACTURER_SHARD_ID,
        abi: manufacturerAbi, 
        bytecode: manufacturerBytecode,
        publicKey: pubkeyHex,
      },
      timestamp: new Date().toISOString(),
    };
    
    fs.writeFileSync(
      path.join(tempDir, 'supply-chain-deployment.json'),
      JSON.stringify(deploymentInfo, null, 2)
    );
    
    // Update constants.ts with the compiled bytecode
    const constantsFilePath = path.join(__dirname, '../action-providers/nil-supply-chain/constants.ts');
    
    const constantsContent = `// Auto-generated by deploy-supply-chain.ts
export const DEFAULT_SHARD_ID = 1;

// Retailer Contract ABI
export const RETAILER_ABI = ${JSON.stringify(retailerAbi, null, 2)} as const;

// Manufacturer Contract ABI
export const MANUFACTURER_ABI = ${JSON.stringify(manufacturerAbi, null, 2)} as const;

// Retailer Contract Bytecode
export const RETAILER_BYTECODE = "${retailerBytecode}";

// Manufacturer Contract Bytecode
export const MANUFACTURER_BYTECODE = "${manufacturerBytecode}";

// Define contract types
export interface ContractType {
  description: string;
  bytecode: string;
  abi?: readonly any[] | any[];
}

export const CONTRACT_TYPES: Record<string, ContractType> = {
  RETAILER: {
    description: "Retailer contract that can order products from manufacturer",
    bytecode: RETAILER_BYTECODE,
    abi: RETAILER_ABI
  },
  MANUFACTURER: {
    description: "Manufacturer contract that creates products ordered by retailer",
    bytecode: MANUFACTURER_BYTECODE,
    abi: MANUFACTURER_ABI
  }
};`;
    
    fs.writeFileSync(constantsFilePath, constantsContent);
    console.log(`Updated constants file at: ${constantsFilePath}`);
    
    // Format the explorer URLs
    const retailerExplorerUrl = `https://explore.nil.foundation/address/${retailerAddress.startsWith('0x') ? retailerAddress.slice(2) : retailerAddress}`;
    const manufacturerExplorerUrl = `https://explore.nil.foundation/address/${manufacturerAddress.startsWith('0x') ? manufacturerAddress.slice(2) : manufacturerAddress}`;
    
    console.log(`\n✅ Supply Chain contracts successfully deployed!`);
    console.log(`- Retailer Address: ${retailerAddress}`);
    console.log(`- Retailer Explorer: ${retailerExplorerUrl}`);
    console.log(`- Manufacturer Address: ${manufacturerAddress}`);
    console.log(`- Manufacturer Explorer: ${manufacturerExplorerUrl}`);
    console.log(`- Deployment details saved to temp/supply-chain-deployment.json`);
    
    console.log(`\nTo order a product, use the order-product action with these addresses:`);
    console.log(`retailerAddress: ${retailerAddress}`);
    console.log(`manufacturerAddress: ${manufacturerAddress}`);
    console.log(`shardId: ${RETAILER_SHARD_ID} (same as manufacturer shard for simplicity)`);
    console.log(`productName: "Your product name here"`);
    
  } catch (error) {
    console.error("Error in deployment process:", error);
  }
}

main().catch(console.error); 