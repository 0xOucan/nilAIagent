export class NilAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NilAccountError';
  }
}

export class SmartAccountCreationError extends NilAccountError {
  constructor(message: string) {
    super(`Failed to create smart account: ${message}`);
    this.name = 'SmartAccountCreationError';
  }
}

export class TopUpError extends NilAccountError {
  constructor(token: string, message: string) {
    super(`Failed to top up ${token}: ${message}`);
    this.name = 'TopUpError';
  }
}

export class TokenMintingError extends NilAccountError {
  constructor(message: string) {
    super(`Token minting failed: ${message}`);
    this.name = 'TokenMintingError';
  }
}

export class InvalidAddressError extends NilAccountError {
  constructor(address: string) {
    super(`Invalid address format: ${address}`);
    this.name = 'InvalidAddressError';
  }
}