import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Timestamped } from './created-at';
import { Idea } from './idea.entity';
import { Member } from './member.entity';

@Entity()
@Index(['tripId', 'date'])
export class ItineraryEntry extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tripId!: string;

  /** YYYY-MM-DD */
  @Column()
  date!: string;

  /** HH:mm or '' for unscheduled */
  @Column({ default: '' })
  startTime!: string;

  @Column()
  title!: string;

  @Column({ default: '' })
  notes!: string;

  @Column({ type: 'varchar', nullable: true })
  ideaId!: string | null;

  @ManyToOne(() => Idea, { onDelete: 'SET NULL', eager: true, nullable: true })
  @JoinColumn({ name: 'ideaId' })
  idea!: Idea | null;

  @Column({ default: 0 })
  position!: number;

  @Column()
  addedById!: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'addedById' })
  addedBy!: Member;
}
