import { BeforeInsert, Column } from 'typeorm';
import { epochMs } from './columns';

/**
 * Creation time as epoch milliseconds. A plain integer is precise and
 * unambiguous for ordering, and it survived the move from SQLite unchanged.
 */
export abstract class Timestamped {
  @Column({ type: 'bigint', transformer: epochMs })
  createdAt!: number;

  @BeforeInsert()
  protected stampCreatedAt(): void {
    if (!this.createdAt) this.createdAt = Date.now();
  }
}
