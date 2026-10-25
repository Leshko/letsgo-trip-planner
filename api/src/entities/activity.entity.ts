import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Timestamped } from './created-at';
import { Member } from './member.entity';

export type ActivityType =
  'joined' | 'idea' | 'vote' | 'comment' | 'itinerary' | 'lodging' | 'trip';

/** One line in the "what's happening" feed: "Sam suggested Kayaking". */
@Entity()
@Index(['tripId', 'createdAt'])
export class Activity extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tripId!: string;

  @Column()
  memberId!: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'memberId' })
  member!: Member;

  @Column({ type: 'varchar' })
  type!: ActivityType;

  /** Verb phrase without the actor, e.g. "suggested Kayaking at the lake". */
  @Column()
  message!: string;

  /** What the line is about, so the UI can link to it. */
  @Column({ type: 'varchar', nullable: true })
  refKind!: 'idea' | 'itinerary' | 'lodging' | null;

  @Column({ type: 'varchar', nullable: true })
  refId!: string | null;
}
