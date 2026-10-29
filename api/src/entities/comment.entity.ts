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
@Index(['ideaId'])
export class Comment extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tripId!: string;

  @Column({ type: 'uuid' })
  ideaId!: string;

  @ManyToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ideaId' })
  idea!: Idea;

  @Column({ type: 'uuid' })
  memberId!: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'memberId' })
  member!: Member;

  @Column()
  body!: string;
}
