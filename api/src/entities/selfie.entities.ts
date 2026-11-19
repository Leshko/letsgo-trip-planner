import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { epochMs } from './columns';
import { Timestamped } from './created-at';
import { Member } from './member.entity';
import { Photo } from './photo.entity';
import { Trip } from './trip.entity';

export type SelfieDifficulty = 'easy' | 'medium' | 'hard';
export const SELFIE_DIFFICULTIES: SelfieDifficulty[] = [
  'easy',
  'medium',
  'hard',
];
export const SELFIE_POINTS: Record<SelfieDifficulty, number> = {
  easy: 10,
  medium: 20,
  hard: 30,
};
/** Extra points for the first person to complete a challenge. */
export const SELFIE_FIRST_BONUS = 5;

/** One selfie to take during the trip, e.g. "Selfie with something bear-shaped". */
@Entity('selfie_challenge')
@Index(['tripId', 'position'])
export class SelfieChallenge extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tripId!: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tripId' })
  trip!: Trip;

  @Column({ type: 'integer' })
  position!: number;

  @Column()
  title!: string;

  /** A line of help: where to find it, or what counts. */
  @Column({ default: '' })
  hint!: string;

  @Column({ type: 'varchar', default: 'easy' })
  difficulty!: SelfieDifficulty;

  @Column({ type: 'integer' })
  points!: number;

  /** Written by the AI, taken from the built-in list, or typed by the organizer. */
  @Column({ type: 'varchar', default: 'ai' })
  source!: 'ai' | 'builtin' | 'custom';

  /**
   * Set when the organizer removed or replaced it. It leaves the list, but
   * selfies that already scored against it keep their points.
   */
  @Column({ type: 'bigint', nullable: true, transformer: epochMs })
  retiredAt!: number | null;
}

/** Someone's selfie for a challenge, and how it was judged. */
@Entity('selfie_entry')
@Index(['challengeId', 'memberId'])
@Index(['tripId'])
export class SelfieEntry extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  challengeId!: string;

  @ManyToOne(() => SelfieChallenge, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'challengeId' })
  challenge!: SelfieChallenge;

  @Column({ type: 'uuid' })
  tripId!: string;

  @Column({ type: 'uuid' })
  memberId!: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'memberId' })
  member!: Member;

  /** The selfie itself is an ordinary album photo; deleting it removes the entry. */
  @Column({ type: 'uuid' })
  photoId!: string;

  @ManyToOne(() => Photo, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'photoId' })
  photo!: Photo;

  @Column({ type: 'varchar' })
  status!: 'approved' | 'rejected';

  /** The AI looked at it, the AI wasn't available (honor system), or the organizer decided. */
  @Column({ type: 'varchar' })
  judgedBy!: 'ai' | 'honor' | 'organizer';

  /** The AI's one-line reaction, or why it didn't count. */
  @Column({ default: '' })
  comment!: string;

  @Column({ type: 'integer', default: 0 })
  points!: number;

  @Column({ type: 'integer', default: 0 })
  bonus!: number;
}
