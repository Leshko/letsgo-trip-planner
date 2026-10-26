import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Member } from './member.entity';
import { Timestamped } from './created-at';

export type PhotoExt = 'jpg' | 'png' | 'webp' | 'gif' | 'heic' | 'heif';

/** A shared trip photo. Bytes live on disk under <dataDir>/photos/<tripId>/. */
@Entity()
@Index(['tripId', 'createdAt'])
@Index(['batchId'])
export class Photo extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tripId!: string;

  @Column()
  memberId!: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'memberId' })
  member!: Member;

  /** One picker selection = one batch, so the feed says "added 5 photos" once. */
  @Column()
  batchId!: string;

  @Column({ default: '' })
  caption!: string;

  @Column()
  originalName!: string;

  @Column()
  mimeType!: string;

  @Column({ type: 'varchar' })
  ext!: PhotoExt;

  @Column({ type: 'integer' })
  bytes!: number;

  @Column({ type: 'integer', nullable: true })
  width!: number | null;

  @Column({ type: 'integer', nullable: true })
  height!: number | null;

  @Column({ default: false })
  hasThumb!: boolean;

  @Column({ default: false })
  hasPreview!: boolean;
}
