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
  * Verification of deployed contracts
  * Explorer links for contract addresses and transactions
- **Balance Checking**
  * Check account balances on any shard
  * Formatted balance display
  * Direct links to blockchain explorer
  * Support for address format with or without 0x prefix
- **Smart Account Management**
  * Create and deploy smart accounts
  * Mint custom tokens
  * Transfer tokens between accounts
  * Burn tokens

### Contract Operations
- **Counter Contract**
  * Simple counter contract deployment
  * Increment counter value
  * Get current counter value

## Upcoming Features

We are actively developing and expanding NIL-specific features:

- [x] Smart contract deployment
- [x] Balance checking functionality
- [x] Smart account and token management
- [ ] Contract interaction tools
- [ ] Cross-shard transactions
- [ ] Additional contract templates
- [ ] Multi-shard operations

## Using Smart Contracts

To deploy a contract:
```
deploy nil contract COUNTER on shard 1
```
or with internal deployment:
```
deploy nil contract COUNTER on shard 1 using internal deployment
```

To check contract status:
```
verify contract [CONTRACT_ADDRESS] on shard 1
```

## Checking Balances

To check address balances:
```
check nil balance 0x0001d849f44e13afef2128cf3170e21b341af2d6
```
or specify a shard:
```
check nil balance 0x0001d849f44e13afef2128cf3170e21b341af2d6 on shard 2
```

## Working with Smart Accounts

Create a new smart account:
```
create smart account on shard 1
```

Mint tokens:
```
mint 1000000 tokens with name "MY_TOKEN" for account 0x00012345...
```

Transfer tokens:
```
transfer 50000 tokens from account 0x00012345... to account 0x00067890...
```

Burn tokens:
```
burn 25000 tokens from account 0x00012345...
```

## Demo Mode

Run a guided demo showcasing key features:
```
Choose mode: demo
```

In Telegram, use:
```
/demo
```

The demo will:
1. Deploy a counter contract
2. Interact with the deployed contract
3. Provide links to explore the contract on the blockchain

## Environment Setup

Required environment variables:
```
OPENAI_API_KEY=your_openai_api_key_here
NIL_RPC_ENDPOINT=your_nil_rpc_endpoint
NIL_FAUCET_ENDPOINT=your_nil_faucet_endpoint
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

## License

MIT License
