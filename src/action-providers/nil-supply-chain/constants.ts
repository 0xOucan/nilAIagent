export const DEFAULT_SHARD_ID = 1;

// Retailer Contract ABI
export const RETAILER_ABI = [
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
] as const;

// Manufacturer Contract ABI
export const MANUFACTURER_ABI = [
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
] as const;

// Retailer Contract Bytecode (placeholder - will need to be replaced with actual compiled bytecode)
export const RETAILER_BYTECODE = "0x608060405234801561001057600080fd5b50610265806100206000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c8063209652551461003b57806361bc221a14610059575b600080fd5b610043610063565b60405161005091906100c9565b60405180910390f35b61006161006c565b005b60008054905090565b600080815480929190610080906100e4565b9190505550565b6000819050919050565b6100a48161008b565b82525050565b60006020820190506100bf600083018461009b565b92915050565b6100c38161008b565b82525050565b60006020820190506100de60008301846100ba565b92915050565b60006100ef8261008b565b91507fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff82036101215761012061012c565b5b600182019050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fdfe";

// Manufacturer Contract Bytecode (placeholder - will need to be replaced with actual compiled bytecode)
export const MANUFACTURER_BYTECODE = "0x608060405234801561001057600080fd5b50604051610527380380610527833981810160405281019061003291906100e6565b816000908161004291906101b8565b5080600160006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550505061022f565b600080fd5b600080fd5b600080fd5b600080fd5b60008083601f8401126100b7576100b6610092565b5b8235905067ffffffffffffffff8111156100d4576100d3610097565b5b6020830191508360208202830111156100f0576100ef61009c565b5b9250929050565b6000600060408486031215610100576100ff610088565b5b600084013567ffffffffffffffff81111561011e5761011d61008d565b5b61012a868287016100a1565b935093505060206101c0868287016101a1565b9250509250929050565b600061c87e905090565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b60006101c482610157565b9150506101cf82610149565b9050919050565b6102e9806102c0565b828152826020830137600081831480156101bf57607f831692505b602082106101ef8704840182610175565b50601f01601f191690910500600050505b92915050565b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b60006102208261011d565b9050919050565b61023082610215565b811461023b57600080fd5b50565b60008151905061024d82610227565b92915050565b60006020828403121561026957610268610088565b5b60006102778482850161023e565b91505092915050565b61028981610224565b82525050565b60006020820190506102a46000830184610280565b92915050565b6000606082019050818103600083015261c37e818461c57e565b9050919050565b6000819050919050565b6102c881610154565b82525050565b60006020820190506102e360008301846102cf565b92915050565b6102f181610270565b82525050";

// Define contract types and exports
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
}; 