/**
 * State machine from LLD section 5.1. Guarded transitions fail in code before
 * they reach PostgreSQL.
 */
export enum CopyStatus {
  AVAILABLE = 'AVAILABLE',
  HELD = 'HELD',
  CHECKED_OUT = 'CHECKED_OUT',
  LOST = 'LOST',
  DAMAGED = 'DAMAGED',
}

export enum HoldStatus {
  ACTIVE = 'ACTIVE',
  QUEUED = 'QUEUED',
  FULFILLED = 'FULFILLED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum LoanStatus {
  OPEN = 'OPEN',
  RETURNED = 'RETURNED',
}

export enum FineStatus {
  ACCRUING = 'ACCRUING',
  FINAL = 'FINAL',
  PAID = 'PAID',
  WAIVED = 'WAIVED',
}

/**
 * Allowed copy transitions (LLD 5.1):
 *   AVAILABLE   -> HELD | CHECKED_OUT | DAMAGED
 *   HELD        -> AVAILABLE | CHECKED_OUT | HELD (pass to next waiter)
 *   CHECKED_OUT -> AVAILABLE | HELD | LOST
 *   LOST/DAMAGED-> AVAILABLE
 */
export function canMoveCopy(from: CopyStatus, to: CopyStatus): boolean {
  switch (from) {
    case CopyStatus.AVAILABLE:
      return [CopyStatus.HELD, CopyStatus.CHECKED_OUT, CopyStatus.DAMAGED].includes(to);
    case CopyStatus.HELD:
      return [CopyStatus.AVAILABLE, CopyStatus.CHECKED_OUT, CopyStatus.HELD].includes(to);
    case CopyStatus.CHECKED_OUT:
      return [CopyStatus.AVAILABLE, CopyStatus.HELD, CopyStatus.LOST].includes(to);
    case CopyStatus.LOST:
    case CopyStatus.DAMAGED:
      return to === CopyStatus.AVAILABLE;
    default:
      return false;
  }
}
