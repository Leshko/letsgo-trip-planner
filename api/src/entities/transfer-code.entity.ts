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

/** A short-lived, single-use code that signs the same member in on another device. */
@Entity()
export class TransferCode extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  @Index()
  code!: string;

  @Column()
  memberId!: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'memberId' })
  member!: Member;

  /** epoch ms */
  @Column({ type: 'integer' })
  expiresAt!: number;

  @Column({ type: 'integer', nullable: true })
  usedAt!: number | null;
}
