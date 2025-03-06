import { PublicClient, HttpTransport, generateSmartAccount } from "@nilfoundation/niljs";
import fs from 'fs';
import path from 'path';
import { Abi, encodeFunctionData } from "viem";

// Configuration
const RPC_ENDPOINT = process.env.NIL_RPC_URL || process.env.NIL_RPC_ENDPOINT || 'https://rpc.nil.foundation';
const FAUCET_ENDPOINT = process.env.NIL_FAUCET_URL || process.env.NIL_FAUCET_ENDPOINT || 'https://faucet.nil.foundation';
const SHARD_ID = 1; // Default shard ID

// Contract interaction options
const ACTION = process.argv[2] || 'getProducts'; // default to getProducts
const RETAILER_ADDRESS = process.argv[3]; 
const MANUFACTURER_ADDRESS = process.argv[4];
const PRODUCT_NAME = process.argv[5] || "Default Product";

async function main() {
  if (!RETAILER_ADDRESS || !MANUFACTURER_ADDRESS) {
    console.error("Error: Retailer and Manufacturer addresses are required.");
    console.log("Usage: npm run interact-supply-chain [action] [retailerAddress] [manufacturerAddress] [productName]");
    console.log("Actions: orderProduct, getProducts");
    process.exit(1);
  }

  try {
    console.log(`Interacting with supply chain contracts...`);
    
    // Load deployment info if exists
    const tempDir = path.join(__dirname, '../../temp');
    const deploymentPath = path.join(tempDir, 'supply-chain-deployment.json');
    
    let retailerAbi: Abi;
    let manufacturerAbi: Abi;
    
    if (fs.existsSync(deploymentPath)) {
      const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
      retailerAbi = deploymentInfo.retailer.abi;
      manufacturerAbi = deploymentInfo.manufacturer.abi;
      console.log("Found deployment info with ABIs.");
    } else {
      // Use hardcoded ABIs as fallback
      retailerAbi = [
        {
          "inputs": [
            {"type": "address", "name": "dst"},
            {"type": "string", "name": "name"}
          ],
          "name": "orderProduct",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {"type": "uint256", "name": "hash"},
            {"type": "bytes", "name": "authData"}
          ],
          "name": "verifyExternal",
          "outputs": [{"type": "bool"}],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "stateMutability": "payable",
          "type": "receive"
        }
      ] as Abi;
      
      manufacturerAbi = [
        {
          "inputs": [
            {"type": "bytes", "name": "pubkeyOne"},
            {"type": "address", "name": "_retailerContractAddress"}
          ],
          "stateMutability": "payable",
          "type": "constructor"
        },
        {
          "inputs": [
            {"type": "string", "name": "productName"}
          ],
          "name": "createProduct",
          "outputs": [{"type": "bool"}],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "getProducts",
          "outputs": [
            {"type": "uint256[]"},
            {"type": "string[]"}
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {"type": "uint256", "name": "hash"},
            {"type": "bytes", "name": "signature"}
          ],
          "name": "verifyExternal",
          "outputs": [{"type": "bool"}],
          "stateMutability": "view",
          "type": "function"
        }
      ] as Abi;
      
      console.log("Using hardcoded ABIs as fallback.");
    }

    // Create a client for the shard
    const client = new PublicClient({
      transport: new HttpTransport({
        endpoint: RPC_ENDPOINT,
      }),
      shardId: SHARD_ID,
    });

    // Normalize addresses
    const retailerAddress = RETAILER_ADDRESS.startsWith('0x') 
      ? RETAILER_ADDRESS as `0x${string}` 
      : `0x${RETAILER_ADDRESS}` as `0x${string}`;
      
    const manufacturerAddress = MANUFACTURER_ADDRESS.startsWith('0x') 
      ? MANUFACTURER_ADDRESS as `0x${string}` 
      : `0x${MANUFACTURER_ADDRESS}` as `0x${string}`;

    // Check if contracts exist
    const retailerCode = await client.getCode(retailerAddress);
    if (!retailerCode || retailerCode.length <= 2) {
      console.error(`❌ No Retailer contract found at ${RETAILER_ADDRESS}`);
      process.exit(1);
    }
    
    const manufacturerCode = await client.getCode(manufacturerAddress);
    if (!manufacturerCode || manufacturerCode.length <= 2) {
      console.error(`❌ No Manufacturer contract found at ${MANUFACTURER_ADDRESS}`);
      process.exit(1);
    }
    
    console.log(`Both contracts exist at the provided addresses`);

    // Handle the action
    if (ACTION === 'getProducts') {
      // This is a read-only call
      const callData = encodeFunctionData({
        abi: manufacturerAbi,
        functionName: 'getProducts',
        args: []
      });
      
      const result = await client.call({
        to: manufacturerAddress,
        data: callData,
      }, 'latest');
      
      console.log(`Product list from Manufacturer contract:`);
      console.log(result);
      
    } else if (ACTION === 'orderProduct') {
      // For orderProduct, we need to create a smart account to send a transaction
      console.log("Creating smart account for transaction...");
      const smartAccount = await generateSmartAccount({
        shardId: SHARD_ID,
        rpcEndpoint: RPC_ENDPOINT,
        faucetEndpoint: FAUCET_ENDPOINT,
      });
      
      console.log(`Using smart account: ${smartAccount.address}`);
      
      // Get gas price for better fee estimation
      const gasPrice = await client.getGasPrice(SHARD_ID);
      const feeCredit = 500_000n * gasPrice;
      
      // Create transaction data for orderProduct
      const data = encodeFunctionData({
        abi: retailerAbi,
        functionName: 'orderProduct',
        args: [manufacturerAddress, PRODUCT_NAME]
      });
      
      // Send the transaction
      console.log(`Ordering product "${PRODUCT_NAME}" through Retailer...`);
      const txResult = await smartAccount.sendTransaction({
        to: retailerAddress,
        data,
        value: 0n,
        feeCredit
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
            break;
          }
        } catch (error) {
          console.log(`Attempt ${retries + 1}: Transaction not yet confirmed...`);
        }
        
        retries++;
      }
      
      if (!confirmed) {
        console.log(`Transaction may still be processing. Check hash ${hash} on the explorer.`);
      } else {
        // Now get the updated product list
        try {
          const callData = encodeFunctionData({
            abi: manufacturerAbi,
            functionName: 'getProducts',
            args: []
          });
          
          const result = await client.call({
            to: manufacturerAddress,
            data: callData,
          }, 'latest');
          
          console.log(`Updated product list:`);
          console.log(result);
        } catch (error) {
          console.error("Error getting updated product list:", error);
        }
      }
    } else {
      console.error(`Unknown action: ${ACTION}`);
      console.log("Supported actions: orderProduct, getProducts");
    }
    
  } catch (error) {
    console.error("Error:", error);
  }
}

main().catch(console.error); 