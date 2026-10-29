import { Column, Entity, PrimaryColumn } from 'typeorm';
import { epochMs } from './columns';

/** Written once, when the old SQLite database is copied into Postgres. Its presence means "done". */
@Entity('legacy_import')
export class LegacyImport {
  @PrimaryColumn()
  id!: string;

  @Column({ type: 'bigint', transformer: epochMs })
  importedAt!: number;

  @Column()
  source!: string;

  /** Row counts per table, as copied and verified. */
  @Column({ type: 'simple-json' })
  counts!: Record<string, number>;
}
