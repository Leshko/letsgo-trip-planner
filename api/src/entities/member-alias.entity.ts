import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Timestamped } from './created-at';
import { Member } from './member.entity';

/**
 * An extra sign-in token for a member. When an admin merges a rejoined
 * person's new spot into their old one, the new device's token is kept here
 * so that device opens the old spot without signing in again.
 */
@Entity('member_alias')
export class MemberAlias extends Timestamped {
  @PrimaryColumn()
  token!: string;

  @Column()
  @Index()
  memberId!: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'memberId' })
  member!: Member;
}
