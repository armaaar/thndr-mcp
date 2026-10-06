/** Base class for every error raised by the domain model. */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A value object or aggregate rejected invalid input. */
export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR';
}

/** An operation violates a business rule (e.g. insufficient cash, market closed). */
export class BusinessRuleViolation extends DomainError {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
