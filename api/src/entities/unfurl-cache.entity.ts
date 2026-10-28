import { Column, Entity, PrimaryColumn } from 'typeorm';
import { Timestamped } from './created-at';

/** AI summaries of pasted links, so the same place never costs twice. */
@Entity('unfurl_cache')
export class UnfurlCache extends Timestamped {
  /** sha256 of the normalized URL */
  @PrimaryColumn()
  urlHash!: string;

  @Column()
  url!: string;

  @Column()
  model!: string;

  @Column({ type: 'text' })
  json!: string;
}
