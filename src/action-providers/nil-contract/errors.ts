export class NilContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NilContractError';
  }
}

export class ContractDeploymentError extends NilContractError {
  constructor(contractType: string, message: string) {
    super(`Failed to deploy ${contractType} contract: ${message}`);
    this.name = 'ContractDeploymentError';
  }
} 