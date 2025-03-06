import { PublicClient, HttpTransport, generateSmartAccount } from "@nilfoundation/niljs";
import fs from 'fs';
import path from 'path';
import { Abi, encodeFunctionData } from "viem";

// Configuration
const RPC_ENDPOINT = process.env.NIL_RPC_URL || 'https://rpc.nil.foundation';
const FAUCET_ENDPOINT = process.env.NIL_FAUCET_URL || 'https://faucet.nil.foundation';
const SHARD_ID = 1; // Default shard ID

// Contract interaction options
const ACTION = process.argv[2] || 'getValue'; // default to getValue
const CONTRACT_ADDRESS = process.argv[3]; // Must be provided

async function main() {
  if (!CONTRACT_ADDRESS) {
    console.error("Error: Contract address is required.");
    console.log("Usage: npm run interact-counter [action] [contractAddress]");
    console.log("Actions: increment, getValue");
    process.exit(1);
  }

  try {
    console.log(`Interacting with Counter contract at ${CONTRACT_ADDRESS}...`);
    
    // Load deployment info if exists
    const tempDir = path.join(__dirname, '../../temp');
    const deploymentPath = path.join(tempDir, 'counter-deployment.json');
    
    let abi: Abi;
    
    if (fs.existsSync(deploymentPath)) {
      const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
      abi = deploymentInfo.abi;
      console.log("Found deployment info with ABI.");
    } else {
      // Use hardcoded Counter ABI
      abi = [
        {
          "inputs": [],
          "name": "increment",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "getValue",
          "outputs": [{"type": "uint256"}],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {"type": "uint256", "name": "hash"},
            {"type": "bytes", "name": "authData"}
          ],
          "name": "verifyExternal",
          "outputs": [{"type": "bool"}],
          "stateMutability": "pure",
          "type": "function"
        }
      ] as Abi;
      console.log("Using hardcoded Counter ABI.");
    }

    // Create a client for the shard
    const client = new PublicClient({
      transport: new HttpTransport({
        endpoint: RPC_ENDPOINT,
      }),
      shardId: SHARD_ID,
    });

    // Check if contract exists
    const contractAddress = CONTRACT_ADDRESS.startsWith('0x') 
      ? CONTRACT_ADDRESS as `0x${string}` 
      : `0x${CONTRACT_ADDRESS}` as `0x${string}`;
      
    const code = await client.getCode(contractAddress);
    if (!code || code.length <= 2) {
      console.error(`❌ No contract found at ${CONTRACT_ADDRESS}`);
      process.exit(1);
    }
    
    console.log(`Contract exists at ${CONTRACT_ADDRESS}`);

    // Handle the action
    if (ACTION === 'getValue') {
      // This is a read-only call, so we can use the client directly
      const callData = encodeFunctionData({
        abi,
        functionName: 'getValue',
        args: []
      });
      
      const result = await client.call({
        to: contractAddress,
        data: callData,
      }, 'latest');
      
      // Convert the result to a number (first cast to unknown, then string)
      const value = parseInt(result as unknown as string, 16);
      console.log(`Current counter value: ${value}`);
      
    } else if (ACTION === 'increment') {
      // For increment, we need to create a smart account to send a transaction
      console.log("Creating smart account for transaction...");
      const smartAccount = await generateSmartAccount({
        shardId: SHARD_ID,
        rpcEndpoint: RPC_ENDPOINT,
        faucetEndpoint: FAUCET_ENDPOINT,
      });
      
      console.log(`Using smart account: ${smartAccount.address}`);
      
      // Create transaction data
      const data = encodeFunctionData({
        abi,
        functionName: 'increment',
        args: []
      });
      
      // Send the transaction
      console.log("Sending increment transaction...");
      const txResult = await smartAccount.sendTransaction({
        to: contractAddress,
        data,
        value: 0n,
        feeCredit: 100000n
      });
      
      // Extract hash from transaction result
      const hash = typeof txResult === 'object' && txResult !== null ? 
        (txResult as any).hash : 
        String(txResult);
      
      console.log(`Transaction sent with hash: ${hash}`);
      
      // Wait for transaction to complete
      console.log("Waiting for transaction confirmation...");
      let retries = 0;
      let confirmed = false;
      
      while (retries < 10 && !confirmed) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        
        try {
          // Check transaction receipt
          const receipt = await client.getTransactionReceiptByHash(hash);
          if (receipt) {
            confirmed = true;
            console.log("Transaction confirmed!");
            
            // Now get the updated counter value
            const callData = encodeFunctionData({
              abi,
              functionName: 'getValue',
              args: []
            });
            
            const result = await client.call({
              to: contractAddress,
              data: callData,
            }, 'latest');
            
            // Convert the result to a number (first cast to unknown, then string)
            const newValue = parseInt(result as unknown as string, 16);
            console.log(`New counter value: ${newValue}`);
            break;
          }
        } catch (error) {
          console.log(`Attempt ${retries + 1}: Transaction not yet confirmed...`);
        }
        
        retries++;
      }
      
      if (!confirmed) {
        console.log(`Transaction may still be processing. Check hash ${hash} on the explorer.`);
      }
      
    } else {
      console.error(`Unknown action: ${ACTION}`);
      console.log("Supported actions: increment, getValue");
    }
    
  } catch (error) {
    console.error("Error:", error);
  }
}

main().catch(console.error); 