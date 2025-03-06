import { generateSmartAccount, PublicClient, HttpTransport, waitTillCompleted } from "@nilfoundation/niljs";
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { Abi, Hex } from 'viem';

// Configuration
const RPC_ENDPOINT = process.env.NIL_RPC_URL || 'https://rpc.nil.foundation';
const FAUCET_ENDPOINT = process.env.NIL_FAUCET_URL || 'https://faucet.nil.foundation';
const SHARD_ID = 1; // Default shard ID

async function main() {
  try {
    console.log("Starting Counter contract deployment...");
    
    // Step 1: Compile the Counter contract
    console.log("Compiling Counter.sol...");
    
    // Create temp directory for solc input/output if it doesn't exist
    const tempDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Path to the Counter.sol file
    const contractPath = path.join(__dirname, '../contracts/Counter.sol');
    
    // Compile the contract using solc
    const outputPath = path.join(tempDir, 'Counter.json');
    try {
      execSync(`solc --optimize --optimize-runs=200 --combined-json abi,bin ${contractPath} > ${outputPath}`);
      console.log("Compilation successful!");
    } catch (error) {
      console.error("Error compiling contract:", error);
      return;
    }
    
    // Read the compiled output
    const compiledOutput = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    const contractKey = Object.keys(compiledOutput.contracts).find(
      key => key.endsWith('Counter.sol:Counter')
    );
    
    if (!contractKey) {
      console.error("Could not find Counter contract in compiled output");
      return;
    }
    
    const contract = compiledOutput.contracts[contractKey];
    const bytecode = `0x${contract.bin}` as Hex;
    const abi = JSON.parse(contract.abi) as Abi;
    
    console.log("Bytecode size:", bytecode.length);
    console.log("ABI functions:", abi.filter((item: any) => item.type === 'function').length);
    
    // Step 2: Deploy the contract
    console.log(`Deploying to shard ${SHARD_ID}...`);
    
    // Create and fund smart account
    const smartAccount = await generateSmartAccount({
      shardId: SHARD_ID,
      rpcEndpoint: RPC_ENDPOINT,
      faucetEndpoint: FAUCET_ENDPOINT,
    });
    
    console.log(`Using smart account: ${smartAccount.address}`);
    
    // Get a client for the shard
    const client = new PublicClient({
      transport: new HttpTransport({
        endpoint: RPC_ENDPOINT,
      }),
      shardId: SHARD_ID,
    });
    
    // Check balance before deployment
    const balanceBefore = await client.getBalance(smartAccount.address as `0x${string}`);
    console.log(`Initial balance: ${balanceBefore}`);
    
    // Generate a random salt
    const salt = BigInt(Math.floor(Math.random() * 10000000000));
    
    // Deploy the contract
    const deployResult = await smartAccount.deployContract({
      bytecode,
      abi,
      args: [], // No constructor arguments for Counter
      salt,
      feeCredit: 500000n,
      shardId: SHARD_ID,
    });
    
    // Extract address and hash from deployment result
    const address = typeof deployResult.address === 'string' ? deployResult.address : String(deployResult.address);
    const hash = typeof deployResult.hash === 'string' ? deployResult.hash : String(deployResult.hash);
    
    console.log(`\nDeployment initiated!`);
    console.log(`Contract address: ${address}`);
    console.log(`Transaction hash: ${hash}`);
    
    // Wait for deployment to be confirmed
    console.log(`\nWaiting for deployment confirmation...`);
    
    try {
      // Use waitTillCompleted to wait for transaction processing
      await waitTillCompleted(client, hash as `0x${string}`);
      console.log("Transaction processing completed!");
    } catch (error) {
      console.log("Error waiting for transaction:", error);
    }
    
    // Wait a bit longer as the code may not be immediately available after transaction completes
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Verify contract code exists at the address
    let retries = 0;
    let isDeployed = false;
    const addressHex = address as `0x${string}`;
    
    while (retries < 10 && !isDeployed) {
      try {
        const code = await client.getCode(addressHex);
        // Check if code exists (not empty)
        if (code && code.length > 2) {  // If length > 2, it's more than just '0x'
          isDeployed = true;
          break;
        }
      } catch (error) {
        console.log(`Attempt ${retries + 1}: Contract not yet deployed...`);
      }
      
      retries++;
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    }
    
    if (isDeployed) {
      // Format the explorer URL without 0x prefix
      const cleanAddress = address.startsWith('0x') ? address.slice(2) : address;
      const explorerUrl = `https://explore.nil.foundation/address/${cleanAddress}`;
      
      console.log(`\n✅ Contract successfully deployed!`);
      console.log(`- Address: ${address}`);
      console.log(`- Explorer: ${explorerUrl}`);
      
      // Save deployment info to file
      const deploymentInfo = {
        contractType: 'Counter',
        address,
        hash,
        shardId: SHARD_ID,
        timestamp: new Date().toISOString(),
        abi: abi,
      };
      
      fs.writeFileSync(
        path.join(tempDir, 'counter-deployment.json'),
        JSON.stringify(deploymentInfo, null, 2)
      );
      
      console.log(`\nDeployment details saved to temp/counter-deployment.json`);
    } else {
      console.log(`\n❌ Deployment timed out or failed. Check transaction ${hash} on the explorer.`);
    }
    
  } catch (error) {
    console.error("Error in deployment process:", error);
  }
}

main().catch(console.error); 