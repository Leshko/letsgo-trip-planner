import { BeforeInsert, Column } from 'typeorm';

/**
 * Creation time as epoch milliseconds. SQLite's datetime('now') only has
 * one-second resolution and TypeORM's string round-trip is timezone-fragile,
 * so a plain integer is both precise and unambiguous for ordering.
 */
export abstract class Timestamped {
  @Column({ type: 'integer' })
  createdAt!: number;

  @BeforeInsert()
  protected stampCreatedAt(): void {
    if (!this.createdAt) this.createdAt = Date.now();
  }
}
