import { EventEmitter2 } from '@nestjs/event-emitter';

export const AVAILABILITY_CHANGED = 'availability.changed';

/**
 * Observer event from LLD section 6.9. It is emitted only *after* the booking
 * transaction commits, which is the NestJS equivalent of Spring's
 * `@TransactionalEventListener(AFTER_COMMIT)`.
 */
export class AvailabilityChangedEvent {
  constructor(public readonly bookId: string) {}
}

/** Emits one event per affected book, de-duplicated. */
export function emitAvailabilityChanged(emitter: EventEmitter2, bookIds: Iterable<string>): void {
  for (const bookId of new Set(bookIds)) {
    emitter.emit(AVAILABILITY_CHANGED, new AvailabilityChangedEvent(bookId));
  }
}
