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

/** A message on the trip wall. Reactions are a map of emoji -> member ids. */
@Entity()
@Index(['tripId', 'createdAt'])
export class Post extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tripId!: string;

  @Column()
  memberId!: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'memberId' })
  member!: Member;

  @Column()
  body!: string;

  @Column({ type: 'simple-json' })
  reactions!: Record<string, string[]>;
}
