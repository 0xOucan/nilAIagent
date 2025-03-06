# NIL Supply Chain Contract Deployment

This document explains how to deploy and use the Retailer and Manufacturer contracts for cross-shard communication on the NIL blockchain.

## Prerequisites

1. Install the required dependencies:
   ```bash
   npm install @nilfoundation/smart-contracts --save
   ```

2. Compile the contracts:
   ```bash
   npx ts-node src/scripts/compile-supply-chain.ts
   ```

## Deployment

You can deploy the contracts using the chatbot interface:

```
deploy-supply-chain-contracts
```

This will:
1. Deploy the Retailer contract on shard 1
2. Deploy the Manufacturer contract on shard 2 (linked to the Retailer)
3. Provide you with the addresses and transaction hashes

## Using the Contracts

### Order a Product

To order a product through the Retailer contract:

```
order-product --retailerAddress <retailer-address> --manufacturerAddress <manufacturer-address> --productName "My Product"
```

This will send a cross-shard message from the Retailer to the Manufacturer.

### Check Products

To check the products created by the Manufacturer:

```
get-manufacturer-products --manufacturerAddress <manufacturer-address>
```

## How It Works

1. The Retailer contract uses `asyncCall` to send a message to the Manufacturer
2. The Manufacturer's `createProduct` function creates a new product when called internally
3. The `getProducts` function allows querying all created products

This demonstrates NIL's cross-shard communication capabilities in a supply chain scenario. 