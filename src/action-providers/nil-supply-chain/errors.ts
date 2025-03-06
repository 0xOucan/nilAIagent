export class NilSupplyChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NilSupplyChainError';
  }
}

export class ContractDeploymentError extends NilSupplyChainError {
  constructor(contractType: string, message: string) {
    super(`Failed to deploy ${contractType} contract: ${message}`);
    this.name = 'ContractDeploymentError';
  }
}

export class ContractInteractionError extends NilSupplyChainError {
  constructor(contractType: string, method: string, message: string) {
    super(`Failed to interact with ${contractType} contract (method: ${method}): ${message}`);
    this.name = 'ContractInteractionError';
  }
} 