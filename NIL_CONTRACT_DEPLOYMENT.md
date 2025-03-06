# NIL Blockchain Contract Deployment Guide

This guide walks you through the process of compiling and deploying smart contracts on the NIL Foundation blockchain using the provided tools.

## Prerequisites

- Node.js 16+ and npm installed
- Solidity compiler (solc) installed globally (`npm install -g solc`)
- Access to NIL RPC and Faucet endpoints

## Quick Start

We've provided scripts to simplify contract deployment and interaction:

```bash
# Deploy the Counter contract
npm run deploy:counter

# Get the current counter value (requires contract address)
npm run call:counter <contract-address>

# Increment the counter value (requires contract address)
npm run increment:counter <contract-address>
```

## Counter Contract

The Counter contract is a simple contract that demonstrates basic functionality on the NIL blockchain:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Counter {
    uint256 private value;

    event ValueChanged(uint256 newValue);

    receive() external payable {}

    function increment() public {
        value += 1;
        emit ValueChanged(value);
    }

    function getValue() public view returns (uint256) {
        return value;
    }
    
    function verifyExternal(
        uint256 hash,
        bytes memory authData
    ) external pure returns (bool) {
        return true;
    }
}
```

## Manual Deployment Process

If you need to deploy contracts manually, follow these steps:

### 1. Compile the Solidity Contract

```bash
solc --optimize --optimize-runs=200 --combined-json abi,bin path/to/Contract.sol > Contract.json
```

This creates a JSON file with the compiled bytecode and ABI.

### 2. Deploy Using the NIL.js Library

```typescript
import { generateSmartAccount, PublicClient, HttpTransport } from "@nilfoundation/niljs";
import { Abi, Hex } from "viem";

// Create and fund smart account
const smartAccount = await generateSmartAccount({
  shardId: 1, // Target shard
  rpcEndpoint: "https://rpc.nil.foundation",
  faucetEndpoint: "https://faucet.nil.foundation",
});

// Generate a random salt
const salt = BigInt(Math.floor(Math.random() * 10000000000));

// Deploy the contract
const { address, hash } = await smartAccount.deployContract({
  bytecode: "0x..." as Hex, // Contract bytecode
  abi: [...] as Abi,        // Contract ABI
  args: [],                 // Constructor arguments (if any)
  salt,                     // Random salt for address generation
  feeCredit: 500000n,       // Fee credit
  shardId: 1,               // Target shard
});
```

### 3. Verify Deployment

```typescript
const client = new PublicClient({
  transport: new HttpTransport({
    endpoint: "https://rpc.nil.foundation",
  }),
  shardId: 1,
});

// Check if contract code exists
const code = await client.getCode(address as `0x${string}`);
if (code && code.length > 2) {
  console.log("Contract deployed successfully!");
}
```

## Interacting with Deployed Contracts

### Reading Contract State

```typescript
// For read-only calls
const data = encodeFunctionData({
  abi,
  functionName: 'getValue',
  args: []
});

const result = await client.call({
  to: contractAddress,
  data,
});

// Parse the result
const value = parseInt(result as unknown as string, 16);
console.log(`Value: ${value}`);
```

### Writing to Contract

```typescript
// For state-changing calls (transactions)
const data = encodeFunctionData({
  abi,
  functionName: 'increment',
  args: []
});

const { hash } = await smartAccount.sendTransaction({
  to: contractAddress,
  data,
  value: 0n,
  feeCredit: 100000n
});

console.log(`Transaction sent with hash: ${hash}`);
```

## Explorer Links

You can view deployed contracts on the NIL explorer:

```
https://explore.nil.foundation/address/<address-without-0x-prefix>
```

For example:
```
https://explore.nil.foundation/address/00017dd88c99eb12ea34632fee8410f023a88054
```

## Troubleshooting

- If deployment fails, check your account balance using `client.getBalance(address)`
- Verify that your smart account has enough NIL tokens for contract deployment
- If a transaction fails, check the transaction receipt using `client.getTransactionReceiptByHash(hash)`

## Additional Resources

- [NIL Foundation Documentation](https://docs.nil.foundation/)
- [NIL.js Documentation](https://docs.nil.foundation/nil/niljs/overview/)
- [Deploying Smart Contracts](https://docs.nil.foundation/nil/cookbook/niljs-deploy/deploy-call-smart-contract/) 