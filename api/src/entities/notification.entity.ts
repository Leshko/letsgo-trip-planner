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
import type { ActivityType } from './activity.entity';

export type RefKind =
  'idea' | 'itinerary' | 'lodging' | 'photo' | 'post' | null;

/** One line in a member's bell: "Dad is in for Kayaking". One row per recipient. */
@Entity()
@Index(['memberId', 'createdAt'])
@Index(['memberId', 'readAt'])
export class Notification extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tripId!: string;

  /** Recipient. */
  @Column()
  memberId!: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'memberId' })
  member!: Member;

  @Column()
  actorId!: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'actorId' })
  actor!: Member;

  @Column({ type: 'varchar' })
  type!: ActivityType;

  @Column()
  message!: string;

  @Column({ type: 'varchar', nullable: true })
  refKind!: RefKind;

  @Column({ type: 'varchar', nullable: true })
  refId!: string | null;

  @Column({ type: 'integer', nullable: true })
  readAt!: number | null;
}
