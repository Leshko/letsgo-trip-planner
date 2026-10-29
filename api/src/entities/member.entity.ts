import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Timestamped } from './created-at';
import { Trip } from './trip.entity';
import { User } from './account.entities';

@Entity()
@Index(['tripId', 'nameKey'], { unique: true })
@Index(['tripId', 'userId'], { unique: true })
export class Member extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tripId!: string;

  @ManyToOne(() => Trip, (t) => t.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tripId' })
  trip!: Trip;

  @Column()
  name!: string;

  /** lower-cased, trimmed name used to let a person rejoin from another device */
  @Column()
  nameKey!: string;

  @Column({ unique: true })
  @Index()
  token!: string;

  @Column({ default: false })
  isOwner!: boolean;

  /** Optional emoji the person picked as their avatar. */
  @Column({ default: '' })
  emoji!: string;

  /** Uploaded profile photo (small JPEG/PNG/WebP), stored inline so a database backup includes it. */
  @Column({ type: 'bytea', nullable: true, select: false })
  avatar!: Buffer | null;

  @Column({ default: '' })
  avatarType!: string;

  @Column({ type: 'integer', default: 0 })
  avatarVersion!: number;

  /** The account this spot in the trip belongs to; null for people who joined without one. */
  @Column({ type: 'uuid', nullable: true })
  @Index()
  userId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user!: User | null;

  /** Notification switches the person turned off; missing keys mean on. */
  @Column({ type: 'simple-json', default: '{}' })
  notifyPrefs!: Record<string, boolean>;
}
