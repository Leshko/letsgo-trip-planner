import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './account.entities';
import { Timestamped } from './created-at';
import { Member } from './member.entity';

export interface Lodging {
  name: string;
  address: string;
  checkIn: string;
  checkOut: string;
  link: string;
  notes: string;
  photos: string[];
}

export const emptyLodging = (): Lodging => ({
  name: '',
  address: '',
  checkIn: '',
  checkOut: '',
  link: '',
  notes: '',
  photos: [],
});

/** A trip (ideas, plan, stay, family map) or a simpler gathering (wall and photos). */
export type TripKind = 'trip' | 'gathering';
export const TRIP_KINDS: TripKind[] = ['trip', 'gathering'];

@Entity()
export class Trip extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Chosen when it's created; gatherings have no ideas, plan or location sharing. */
  @Column({ default: 'trip' })
  kind!: TripKind;

  @Column()
  name!: string;

  @Column({ default: '' })
  destination!: string;

  /** ISO date, YYYY-MM-DD */
  @Column()
  startDate!: string;

  /** ISO date, YYYY-MM-DD, inclusive */
  @Column()
  endDate!: string;

  @Column({ unique: true })
  inviteCode!: string;

  @Column({ type: 'simple-json' })
  lodging!: Lodging;

  /** The organizer's account (plans and billing hang off this). Null until they sign in. */
  @Column({ type: 'uuid', nullable: true })
  @Index()
  ownerUserId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'ownerUserId' })
  ownerUser!: User | null;

  /**
   * Where the trip happens (IANA zone, e.g. America/Los_Angeles), reported by
   * phones sharing their location. Used to end the family map at local midnight.
   */
  @Column({ default: '' })
  timeZone!: string;

  /** The selfie game runs by itself on trip days unless the organizer switches it off. */
  @Column({ type: 'varchar', default: 'on' })
  selfieGame!: 'on' | 'off';

  @OneToMany(() => Member, (m) => m.trip)
  members!: Member[];
}
