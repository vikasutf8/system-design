/**
 * Domain errors carry the exact error code + HTTP status from LLD section 9.4.
 * GlobalExceptionFilter serialises them as { code, message, traceId }.
 */
export class DomainException extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationDomainException extends DomainException {
  constructor(message: string) {
    super('VALIDATION_ERROR', 400, message);
  }
}

export class UnauthenticatedException extends DomainException {
  constructor(message = 'Missing or invalid JWT') {
    super('UNAUTHENTICATED', 401, message);
  }
}

export class ForbiddenException extends DomainException {
  constructor(message = 'You are not allowed to perform this action') {
    super('FORBIDDEN', 403, message);
  }
}

export class DomainNotFoundException extends DomainException {
  constructor(code: string, message: string) {
    super(code, 404, message);
  }
}

export class HoldNotActiveException extends DomainException {
  constructor(holdId: string) {
    super('HOLD_NOT_ACTIVE', 409, `Hold ${holdId} is not active`);
  }
}

export class DuplicateHoldException extends DomainException {
  constructor(message = 'The member already has an open hold for this book') {
    super('DUPLICATE_HOLD', 409, message);
  }
}

export class IllegalStateTransitionException extends DomainException {
  constructor(entity: string, from: string, to: string) {
    super(
      'ILLEGAL_STATE_TRANSITION',
      409,
      `Illegal state transition for ${entity}: ${from} -> ${to}`,
    );
  }
}

export class DuplicateIsbnException extends DomainException {
  constructor(isbn: string) {
    super('DUPLICATE_ISBN', 409, `A book with ISBN ${isbn} already exists`);
  }
}

export class NoCopyAvailableException extends DomainException {
  constructor(bookId: string) {
    super('NO_COPY_AVAILABLE', 409, `No copy is available for book ${bookId}`);
  }
}

export class HoldExpiredException extends DomainException {
  constructor(holdId: string) {
    super('HOLD_EXPIRED', 422, `Hold ${holdId} has expired`);
  }
}

export class HoldLimitReachedException extends DomainException {
  constructor(limit: number) {
    super('HOLD_LIMIT_REACHED', 422, `A member may have at most ${limit} open holds`);
  }
}

export class UnpaidFinesException extends DomainException {
  constructor(threshold: number) {
    super(
      'UNPAID_FINES',
      422,
      `Unpaid fines are above the blocking threshold of ${threshold.toFixed(2)}`,
    );
  }
}

export class ServiceUnavailableException extends DomainException {
  constructor(message = 'A dependency is unavailable, please retry') {
    super('SERVICE_UNAVAILABLE', 503, message);
  }
}

export class RateLimitedException extends DomainException {
  constructor(message = 'Rate limit exceeded') {
    super('RATE_LIMITED', 429, message);
  }
}

// ----- PostgreSQL error helpers ---------------------------------------------

interface PgLikeError {
  code?: string;
  constraint?: string;
}

export function pgError(error: unknown): PgLikeError | undefined {
  const anyError = error as { driverError?: PgLikeError; code?: string } | undefined;
  if (!anyError) return undefined;
  if (anyError.driverError) return anyError.driverError;
  if (typeof anyError.code === 'string') return anyError as PgLikeError;
  return undefined;
}

/** Unique constraint violation (SQLSTATE 23505). */
export function isUniqueViolation(error: unknown): boolean {
  return pgError(error)?.code === '23505';
}

/** Row lock could not be acquired within lock_timeout (SQLSTATE 55P03). */
export function isLockTimeout(error: unknown): boolean {
  return pgError(error)?.code === '55P03';
}

/** Statement exceeded statement_timeout (SQLSTATE 57014). */
export function isStatementTimeout(error: unknown): boolean {
  return pgError(error)?.code === '57014';
}
