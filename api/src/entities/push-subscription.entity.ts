import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Member } from './member.entity';
import { Timestamped } from './created-at';

/** A browser's Web Push endpoint, or a phone app's push token, for one member. A member can have several devices. */
@Entity()
export class PushSubscription extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  memberId!: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'memberId' })
  member!: Member;

  @Column({ unique: true })
  endpoint!: string;

  @Column()
  p256dh!: string;

  @Column()
  auth!: string;

  @Column({ default: '' })
  userAgent!: string;

  /** 'web' (browser), 'apns' (iPhone app) or 'fcm' (Android app). For the apps, endpoint holds the device token. */
  @Column({ default: 'web' })
  kind!: string;

  /** The web address the subscription was made on (notifications open there). */
  @Column({ default: '' })
  origin!: string;
}
