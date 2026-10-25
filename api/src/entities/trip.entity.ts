import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
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

@Entity()
export class Trip extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

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

  @OneToMany(() => Member, (m) => m.trip)
  members!: Member[];
}
