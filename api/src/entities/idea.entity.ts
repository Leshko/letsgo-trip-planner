import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Timestamped } from './created-at';
import { Member } from './member.entity';
import { Vote } from './vote.entity';

export type IdeaKind = 'activity' | 'food';
export const IDEA_KINDS: IdeaKind[] = ['activity', 'food'];

export type CostLevel = '' | 'free' | '$' | '$$' | '$$$';
export const COST_LEVELS: CostLevel[] = ['', 'free', '$', '$$', '$$$'];

@Entity()
@Index(['tripId', 'kind'])
export class Idea extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tripId!: string;

  @Column({ type: 'varchar' })
  kind!: IdeaKind;

  @Column()
  title!: string;

  @Column({ default: '' })
  description!: string;

  @Column({ default: '' })
  link!: string;

  @Column({ default: '' })
  address!: string;

  @Column({ type: 'varchar', default: '' })
  cost!: CostLevel;

  @Column()
  suggestedById!: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'suggestedById' })
  suggestedBy!: Member;

  @OneToMany(() => Vote, (v) => v.idea, { eager: true })
  votes!: Vote[];
}
