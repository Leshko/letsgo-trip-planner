import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { epochMs } from './columns';
import { Member } from './member.entity';

/**
 * Where a member last was, kept only while they share their location during
 * the trip. Switching sharing off, or the trip ending, deletes the row.
 */
@Entity('member_location')
export class MemberLocation {
  @PrimaryColumn({ type: 'uuid' })
  memberId!: string;

  @OneToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'memberId' })
  member!: Member;

  @Column({ type: 'double precision' })
  lat!: number;

  @Column({ type: 'double precision' })
  lng!: number;

  /** Metres, as reported by the phone. */
  @Column({ type: 'integer', default: 0 })
  accuracy!: number;

  /** Epoch milliseconds of the last update. */
  @Column({ type: 'bigint', transformer: epochMs })
  updatedAt!: number;
}
