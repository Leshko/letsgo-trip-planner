import {
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Column,
} from 'typeorm';
import { Timestamped } from './created-at';
import { Idea } from './idea.entity';
import { Member } from './member.entity';

@Entity()
@Index(['ideaId', 'memberId'], { unique: true })
export class Vote extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  ideaId!: string;

  @ManyToOne(() => Idea, (i) => i.votes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ideaId' })
  idea!: Idea;

  @Column()
  memberId!: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'memberId' })
  member!: Member;
}
