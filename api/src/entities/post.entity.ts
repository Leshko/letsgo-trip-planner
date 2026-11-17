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

/** A poll attached to a wall post: the post's body is the question. */
export interface PollData {
  /** People may pick more than one option. */
  multiple: boolean;
  /** Voting has been closed by the author or the organizer. */
  closed: boolean;
  options: { id: string; text: string; votes: string[] }[];
}

/** A message on the trip wall. Reactions are a map of emoji -> member ids. */
@Entity()
@Index(['tripId', 'createdAt'])
export class Post extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tripId!: string;

  @Column({ type: 'uuid' })
  memberId!: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'memberId' })
  member!: Member;

  @Column()
  body!: string;

  @Column({ type: 'simple-json' })
  reactions!: Record<string, string[]>;

  /** Set when the post is a poll; option votes hold member ids. */
  @Column({ type: 'simple-json', nullable: true })
  poll!: PollData | null;
}
