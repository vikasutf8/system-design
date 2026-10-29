/**
 * Domain event payloads published through the outbox to Kafka.
 * Notification consumers are idempotent because delivery is at least once.
 */
export interface HoldPlacedEvent {
  type: 'HoldPlaced';
  holdId: string;
  userId: string;
  bookId: string;
  copyId: string | null;
  status: string;
  expiresAt: string | null;
  occurredAt: string;
}

export interface HoldReadyEvent {
  type: 'HoldReady';
  holdId: string;
  userId: string;
  bookId: string;
  copyId: string;
  expiresAt: string | null;
  occurredAt: string;
}

export interface HoldCancelledEvent {
  type: 'HoldCancelled';
  holdId: string;
  userId: string;
  bookId: string;
  occurredAt: string;
}

export interface HoldExpiredEvent {
  type: 'HoldExpired';
  holdId: string;
  userId: string;
  bookId: string;
  occurredAt: string;
}

export interface LoanCreatedEvent {
  type: 'LoanCreated';
  loanId: string;
  userId: string;
  copyId: string;
  bookId: string;
  dueAt: string;
  occurredAt: string;
}

export interface LoanReturnedEvent {
  type: 'LoanReturned';
  loanId: string;
  userId: string;
  copyId: string;
  bookId: string;
  returnedAt: string;
  occurredAt: string;
}
