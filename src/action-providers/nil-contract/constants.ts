import type { AbiFunction } from 'abitype';

export const DEFAULT_SHARD_ID = 1;
export const DEFAULT_GAS_MULTIPLIER = 1_000_000n;

// Counter Contract ABI
export const COUNTER_ABI = [
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
  },
  {
    "stateMutability": "payable",
    "type": "receive"
  }
] as const;

// Counter Contract Bytecode - Remove newlines and template literal
export const COUNTER_BYTECODE = "0x608060405234801561001057600080fd5b50610265806100206000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c8063209652551461003b57806361bc221a14610059575b600080fd5b610043610063565b60405161005091906100c9565b60405180910390f35b61006161006c565b005b60008054905090565b600080815480929190610080906100e4565b9190505550565b6000819050919050565b6100a48161008b565b82525050565b60006020820190506100bf600083018461009b565b92915050565b6100c38161008b565b82525050565b60006020820190506100de60008301846100ba565b92915050565b60006100ef8261008b565b91507fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff82036101215761012061012c565b5b600182019050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fdfe" as const;

// Contract types mapping
export const CONTRACT_TYPES = {
  COUNTER: {
    bytecode: COUNTER_BYTECODE,
    abi: COUNTER_ABI
  }
} as const;

export type ContractType = keyof typeof CONTRACT_TYPES;