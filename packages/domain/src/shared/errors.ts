/** Raised when input to a domain engine is outside what the engine can safely reason about. */
export class DomainValidationError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "DomainValidationError";
  }
}

export function assertFiniteInRange(value: number, min: number, max: number, field: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new DomainValidationError(`${field} must be between ${min} and ${max}`, field);
  }
}

export function assertInteger(value: number, field: string): void {
  if (!Number.isInteger(value)) {
    throw new DomainValidationError(`${field} must be a whole number`, field);
  }
}
