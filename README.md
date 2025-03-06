# NIL Foundation Blockchain Chatbot

A versatile chatbot for interacting with the NIL blockchain, featuring smart contract deployment and blockchain interactions.

## Current Features

### Interactive Modes
- **Chat Mode**: Interactive conversation with the AI assistant
- **Telegram Mode**: Interact with the assistant through Telegram
- **Demo Mode**: Guided demonstration of key features
- **Auto Mode**: Autonomous execution of actions

### NIL Blockchain Operations
- **Smart Contract Deployment**
  * Deploy contracts to NIL blockchain shards
  * Support for both internal and external deployment methods
  * Multiple contract types: Counter, Advanced Counter, Token (ERC20), Manufacturer, Retailer
  * Verification of deployed contracts
  * Explorer links for contract addresses and transactions
  * Dynamic gas pricing based on contract complexity
  * Cometa service integration for compilation and verification
- **Balance Checking**
  * Check account balances on any shard
  * Formatted balance display
  * Direct links to blockchain explorer
  * Support for address format with or without 0x prefix
- **Smart Account Management**
  * Create and deploy smart accounts with recovery capabilities
  * Account recovery via private key
  * Mint custom tokens with name and symbol
  * Transfer tokens between accounts
  * Batch transfer tokens to multiple recipients
  * Cross-shard token transfers
  * Burn tokens
  * Shard detection from address format
- **Supply Chain Operations**
  * Deploy supply chain contracts (Retailer and Manufacturer) in sequence
  * Correct deployment order ensuring Manufacturer has Retailer address
  * Order products through Retailer to create them in Manufacturer
  * Retrieve product information from Manufacturer

## Available Commands

### Contract Deployment
```
deploy nil contract COUNTER on shard 1                  # Deploy a counter contract
deploy nil contract TOKEN on shard 1 with name "My Token" symbol "MTK" supply 1000000   # Deploy a token
deploy supply chain contracts on shard 1               # Deploy Retailer and Manufacturer contracts in sequence
```

### Account Management
```
deploy smart account                                    # Create a new smart account
check wallet balance 0x000160268b325682997a35f5015778ed6b98c6a8   # Check wallet balance
```

### Contract Interactions
```
increment counter 0x00011566776d6011696cabe1b25844db5992b71f     # Interact with counter contract
order product from retailer 0x00010510d52bb69b1b93ee6ae26a19d8595f5142 to manufacturer 0x00015e35e7d3629ace79d0e4b5356a12335c3308 with name "Product1"   # Order product in supply chain
get products from manufacturer 0x00015e35e7d3629ace79d0e4b5356a12335c3308   # Get products from manufacturer
```

## Environment Setup

Required environment variables:
```
OPENAI_API_KEY=your_openai_api_key_here
NIL_RPC_ENDPOINT=your_nil_rpc_endpoint
NIL_FAUCET_ENDPOINT=your_nil_faucet_endpoint
NIL_PRIVATE_KEY=your_nil_private_key_here (optional)
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here (optional)
```

## Getting Started

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and fill in your credentials
4. Build the project: `npm run build`
5. Start the chatbot: `npm start`

## NIL Blockchain Specifics

- Block Explorer: https://explore.nil.foundation
- NIL Documentation: https://docs.nil.foundation/
- NIL.js Documentation: https://docs.nil.foundation/nil/niljs/getting-started

## Supply Chain Contract Usage

Deploy both contracts in sequence:
```
deploy supply chain contracts on shard 1
```

Order a product (after deployment):
```
order product from retailer [RETAILER_ADDRESS] to manufacturer [MANUFACTURER_ADDRESS] with name "Product1"
```

Get all products:
```
get products from manufacturer [MANUFACTURER_ADDRESS]
```

## License

MIT License