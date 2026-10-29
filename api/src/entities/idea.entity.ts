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

export interface IdeaDetail {
  label: string;
  value: string;
}

export type CostLevel = '' | 'free' | '$' | '$$' | '$$$';
export const COST_LEVELS: CostLevel[] = ['', 'free', '$', '$$', '$$$'];

@Entity()
@Index(['tripId', 'kind'])
export class Idea extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
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

  /** Link to the menu, for places to eat. */
  @Column({ default: '' })
  menuUrl!: string;

  @Column({ type: 'varchar', default: '' })
  cost!: CostLevel;

  /** Cover image picked from the link preview (or pasted directly). */
  @Column({ default: '' })
  imageUrl!: string;

  @Column({ default: '' })
  siteName!: string;

  /** Extra facts the family adds: hours, price, phone, booking notes… */
  @Column({ type: 'simple-json', default: '[]' })
  details!: IdeaDetail[];

  @Column({ type: 'uuid' })
  suggestedById!: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'suggestedById' })
  suggestedBy!: Member;

  @OneToMany(() => Vote, (v) => v.idea, { eager: true })
  votes!: Vote[];
}
