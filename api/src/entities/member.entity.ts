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

@Entity()
@Index(['tripId', 'nameKey'], { unique: true })
export class Member extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
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

  /** Uploaded profile photo (small JPEG/PNG/WebP), stored inline so the SQLite file is the whole backup. */
  @Column({ type: 'blob', nullable: true, select: false })
  avatar!: Buffer | null;

  @Column({ default: '' })
  avatarType!: string;

  @Column({ type: 'integer', default: 0 })
  avatarVersion!: number;
}
