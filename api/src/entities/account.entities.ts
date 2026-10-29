import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { epochMs } from './columns';
import { Timestamped } from './created-at';

export type AuthProvider = 'google' | 'microsoft' | 'email';

/**
 * A person with a real sign-in. One user can be a member of many trips;
 * joining a trip without an account still works (the member just has no user).
 */
@Entity('app_user')
export class User extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Only verified addresses are stored here; it's how sign-ins are matched up. */
  @Column({ type: 'varchar', nullable: true, unique: true })
  email!: string | null;

  @Column({ default: '' })
  name!: string;

  @Column({ type: 'bigint', nullable: true, transformer: epochMs })
  lastSignInAt!: number | null;
}

/** One way of signing in (a Google account, a Microsoft account, an email address). */
@Entity('user_identity')
@Index(['provider', 'subject'], { unique: true })
export class Identity extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar' })
  provider!: AuthProvider;

  /** The provider's stable id for the person (OIDC "sub"; the address for email). */
  @Column()
  subject!: string;

  /** As reported by the provider, for display. */
  @Column({ default: '' })
  email!: string;
}

/** A signed-in device. Only a hash of the token is stored. */
@Entity('account_session')
export class AccountSession extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ unique: true })
  tokenHash!: string;

  @Column({ type: 'bigint', transformer: epochMs })
  expiresAt!: number;

  @Column({ type: 'bigint', transformer: epochMs })
  lastUsedAt!: number;

  @Column({ default: '' })
  userAgent!: string;
}

/** A 6-digit code (and matching link) emailed to sign someone in. */
@Entity('email_code')
@Index(['email', 'createdAt'])
export class EmailCode extends Timestamped {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  email!: string;

  @Column()
  codeHash!: string;

  @Column({ unique: true })
  linkHash!: string;

  @Column({ type: 'bigint', transformer: epochMs })
  expiresAt!: number;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ type: 'bigint', nullable: true, transformer: epochMs })
  usedAt!: number | null;
}

/** An in-progress Google/Microsoft sign-in, between leaving the app and coming back. */
@Entity('auth_flow')
export class AuthFlow {
  @PrimaryColumn()
  state!: string;

  @Column({ type: 'varchar' })
  provider!: AuthProvider;

  @Column()
  verifier!: string;

  @Column()
  nonce!: string;

  @Column({ default: '/trips' })
  returnTo!: string;

  @Column({ type: 'bigint', transformer: epochMs })
  expiresAt!: number;
}

/** A one-time, two-minute code that turns a finished provider sign-in into a session in the app. */
@Entity('auth_handoff')
export class AuthHandoff {
  @PrimaryColumn()
  codeHash!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'bigint', transformer: epochMs })
  expiresAt!: number;
}
