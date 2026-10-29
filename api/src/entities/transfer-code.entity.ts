import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { epochMs } from './columns';
import { Member } from './member.entity';
import { Timestamped } from './created-at';

/** A short-lived, single-use code that signs the same member in on another device. */
@Entity()
export class TransferCode extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  @Index()
  code!: string;

  @Column({ type: 'uuid' })
  memberId!: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'memberId' })
  member!: Member;

  /** epoch ms */
  @Column({ type: 'bigint', transformer: epochMs })
  expiresAt!: number;

  @Column({ type: 'bigint', nullable: true, transformer: epochMs })
  usedAt!: number | null;
}
