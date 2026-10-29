import { Column, Entity, PrimaryColumn } from 'typeorm';
import { UserRole } from '../../common/auth/roles';

/** Minimal user projection used for eligibility checks. */
@Entity('users')
export class User {
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', unique: true })
  email: string;

  @Column({ type: 'text' })
  role: UserRole;

  @Column({ type: 'text', default: 'ACTIVE' })
  status: string;
}
