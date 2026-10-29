import { Column, Entity, PrimaryColumn } from 'typeorm';
import { FineStatus } from './enums';

/**
 * NUMERIC columns come back from node-postgres as strings. This transformer
 * keeps the domain model using numbers for calculations and JSON responses.
 */
const numericToNumber = {
  to: (value: number): number => value,
  from: (value: string | number): number => Number(value),
};

@Entity('fines')
export class Fine {
  @PrimaryColumn({ type: 'uuid', name: 'fine_id' })
  fineId: string;

  @Column({ type: 'uuid', name: 'loan_id' })
  loanId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'int', name: 'days_overdue' })
  daysOverdue: number;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    transformer: numericToNumber,
  })
  amount: number;

  @Column({ type: 'text' })
  status: FineStatus;

  @Column({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
