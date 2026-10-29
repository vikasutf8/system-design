import { Column, Entity, PrimaryColumn } from 'typeorm';
import { IllegalStateTransitionException } from '../../common/exceptions/domain.exception';
import { CopyStatus, canMoveCopy } from './enums';

/** One physical copy. book_id points at the MongoDB catalog document. */
@Entity('book_copy')
export class BookCopy {
  @PrimaryColumn({ type: 'uuid', name: 'copy_id' })
  copyId: string;

  @Column({ type: 'text', name: 'book_id' })
  bookId: string;

  @Column({ type: 'text' })
  status: CopyStatus;

  @Column({ type: 'int', default: 0 })
  version: number;

  @Column({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  /** Guarded state transition; throws before persisting an illegal change. */
  transitionTo(target: CopyStatus): void {
    if (!canMoveCopy(this.status, target)) {
      throw new IllegalStateTransitionException('book_copy', this.status, target);
    }
    this.status = target;
    this.updatedAt = new Date();
  }
}
