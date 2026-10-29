import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import {
  AccountSession,
  AuthFlow,
  AuthHandoff,
  AuthProvider,
  EmailCode,
  Identity,
  User,
} from '../entities';
import {
  OAUTH_PROVIDERS,
  OAuthProvider,
  providerConfig,
  publicUrl,
  safeReturnTo,
} from './auth.config';
import { randomToken, sameHash, sha256, sixDigits } from './crypto.util';
import { MailService } from './mail.service';
import { OidcProfile, OidcService } from './oidc.service';

const DAY = 24 * 60 * 60_000;
const SESSION_TTL = 180 * DAY;
const FLOW_TTL = 15 * 60_000;
const HANDOFF_TTL = 2 * 60_000;
const EMAIL_CODE_TTL = 15 * 60_000;
const EMAIL_MAX_PER_HOUR = 5;
const EMAIL_MAX_ATTEMPTS = 5;

export interface UserView {
  id: string;
  name: string;
  email: string;
  signIns: { provider: AuthProvider; email: string }[];
}

export interface SignedIn {
  token: string;
  user: UserView;
}

@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth');

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Identity)
    private readonly identities: Repository<Identity>,
    @InjectRepository(AccountSession)
    private readonly sessions: Repository<AccountSession>,
    @InjectRepository(EmailCode) private readonly codes: Repository<EmailCode>,
    @InjectRepository(AuthFlow) private readonly flows: Repository<AuthFlow>,
    @InjectRepository(AuthHandoff)
    private readonly handoffs: Repository<AuthHandoff>,
    private readonly oidc: OidcService,
    private readonly mail: MailService,
  ) {}

  providers(): Record<OAuthProvider | 'email', boolean> {
    return {
      google: !!providerConfig('google'),
      microsoft: !!providerConfig('microsoft'),
      email: this.mail.configured,
    };
  }

  /** Whether this server offers any way to sign in at all. */
  anySignIn(): boolean {
    return Object.values(this.providers()).some(Boolean);
  }

  // ---------- Google / Microsoft ----------

  /** Where to send the browser to start signing in. */
  async startOAuth(provider: string, returnTo: unknown): Promise<string> {
    const cfg = this.oauthConfig(provider);
    if (!cfg) return '/signin?error=unavailable';
    await this.flows.delete({ expiresAt: LessThan(Date.now()) });
    const f = await this.oidc.start(cfg);
    await this.flows.insert({
      state: f.state,
      provider: cfg.id,
      verifier: f.verifier,
      nonce: f.nonce,
      returnTo: safeReturnTo(returnTo),
      expiresAt: Date.now() + FLOW_TTL,
    });
    return f.url;
  }

  /** The provider sent the browser back; turn it into a one-time code for the app. */
  async finishOAuth(
    provider: string,
    q: { code?: string; state?: string; error?: string },
  ): Promise<string> {
    const cfg = this.oauthConfig(provider);
    if (!cfg) return '/signin?error=unavailable';
    const flow = q.state
      ? await this.flows.findOne({
          where: { state: q.state, provider: cfg.id },
        })
      : null;
    if (flow) await this.flows.delete({ state: flow.state });
    if (q.error) return '/signin?error=cancelled';
    if (!flow || flow.expiresAt < Date.now() || !q.code)
      return '/signin?error=expired';
    let profile: OidcProfile;
    try {
      profile = await this.oidc.finish(cfg, q.code, flow.verifier, flow.nonce);
    } catch (e) {
      this.log.warn(`${cfg.id} sign-in failed: ${String(e)}`);
      return '/signin?error=failed';
    }
    const user = await this.userForIdentity(cfg.id, profile);
    const code = await this.handoffCode(user.id);
    const next = encodeURIComponent(flow.returnTo);
    return `/auth/done?code=${encodeURIComponent(code)}&next=${next}`;
  }

  /**
   * A one-time, two-minute code that becomes a session for this user wherever
   * it's redeemed: after a provider sign-in, or when a signed-in phone moves
   * from the old web address to the new one.
   */
  async handoffCode(userId: string): Promise<string> {
    const code = randomToken(32);
    await this.handoffs.delete({ expiresAt: LessThan(Date.now()) });
    await this.handoffs.insert({
      codeHash: sha256(code),
      userId,
      expiresAt: Date.now() + HANDOFF_TTL,
    });
    return code;
  }

  async exchange(code: string, userAgent: string): Promise<SignedIn> {
    const h = await this.handoffs.findOne({
      where: { codeHash: sha256(code) },
    });
    if (h) await this.handoffs.delete({ codeHash: h.codeHash });
    if (!h || h.expiresAt < Date.now())
      throw new BadRequestException(
        'That sign-in link expired. Please try again.',
      );
    const user = await this.users.findOneByOrFail({ id: h.userId });
    return this.signIn(user, userAgent);
  }

  private oauthConfig(provider: string) {
    return (OAUTH_PROVIDERS as string[]).includes(provider)
      ? providerConfig(provider as OAuthProvider)
      : null;
  }

  // ---------- Email code ----------

  async startEmail(rawEmail: string): Promise<void> {
    if (!this.mail.configured)
      throw new ServiceUnavailableException("Email sign-in isn't set up yet");
    const email = rawEmail.trim().toLowerCase();
    const recent = await this.codes.count({
      where: { email, createdAt: MoreThan(Date.now() - 60 * 60_000) },
    });
    if (recent >= EMAIL_MAX_PER_HOUR)
      throw new HttpException(
        'Too many codes sent to that address. Try again in an hour.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    await this.codes.delete({ expiresAt: LessThan(Date.now() - DAY) });
    // Only the newest code works.
    await this.codes.update(
      { email, usedAt: IsNull() },
      { usedAt: Date.now() },
    );

    const code = sixDigits();
    const link = randomToken(32);
    const row = this.codes.create({
      email,
      codeHash: '',
      linkHash: sha256(link),
      expiresAt: Date.now() + EMAIL_CODE_TTL,
      attempts: 0,
      usedAt: null,
    });
    row.codeHash = sha256(`${email}:${code}`);
    await this.codes.save(row);

    const base = publicUrl();
    const url = base ? `${base}/auth/email?t=${encodeURIComponent(link)}` : '';
    await this.mail.send({
      to: email,
      subject: `${code} is your LetsGo Together sign-in code`,
      text: [
        `Your LetsGo Together sign-in code is ${code}`,
        '',
        url ? `Or open this link to sign in: ${url}` : '',
        '',
        'It works for 15 minutes. If you did not ask for this, you can ignore this email.',
      ]
        .filter((l, i, a) => l || a[i - 1])
        .join('\n'),
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:auto;padding:24px;color:#1c1c1e">
  <h2 style="margin:0 0 8px">Sign in to LetsGo Together</h2>
  <p style="margin:0 0 16px;color:#555">Type this code in the app:</p>
  <p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:0 0 20px">${code}</p>
  ${url ? `<p><a href="${url}" style="display:inline-block;background:#0f8fb8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600">Sign in</a></p>` : ''}
  <p style="color:#888;font-size:13px">It works for 15 minutes. If you didn't ask for this, you can ignore this email.</p>
</div>`,
    });
  }

  async verifyEmail(
    input: { email?: string; code?: string; token?: string },
    userAgent: string,
  ): Promise<SignedIn> {
    const bad = () =>
      new BadRequestException(
        "That code didn't work. Check it, or send a new one.",
      );
    let row: EmailCode | null = null;
    if (input.token) {
      row = await this.codes.findOne({
        where: { linkHash: sha256(input.token) },
      });
      if (!row || row.usedAt || row.expiresAt < Date.now())
        throw new BadRequestException(
          'That sign-in link expired. Send a new code.',
        );
    } else {
      const email = (input.email ?? '').trim().toLowerCase();
      const code = (input.code ?? '').replace(/\D/g, '');
      row = await this.codes.findOne({
        where: { email, usedAt: IsNull() },
        order: { createdAt: 'DESC' },
      });
      if (!row || row.expiresAt < Date.now()) throw bad();
      if (row.attempts >= EMAIL_MAX_ATTEMPTS)
        throw new HttpException(
          'Too many tries. Send a new code.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      if (!sameHash(row.codeHash, sha256(`${email}:${code}`))) {
        await this.codes.increment({ id: row.id }, 'attempts', 1);
        throw bad();
      }
    }
    // Single use, even if two requests race.
    const claimed = await this.codes.update(
      { id: row.id, usedAt: IsNull() },
      { usedAt: Date.now() },
    );
    if (!claimed.affected) throw bad();
    const user = await this.userForIdentity('email', {
      subject: row.email,
      email: row.email,
      emailVerified: true,
      name: '',
    });
    return this.signIn(user, userAgent);
  }

  // ---------- users and sessions ----------

  /**
   * Same provider account → same user. Otherwise a verified address joins an
   * existing account with that address; anything else becomes a new account.
   */
  private async userForIdentity(
    provider: AuthProvider,
    p: OidcProfile,
  ): Promise<User> {
    return this.ds.transaction(async (m) => {
      const existing = await m.findOne(Identity, {
        where: { provider, subject: p.subject },
        relations: { user: true },
      });
      if (existing) {
        if (p.email && existing.email !== p.email) {
          existing.email = p.email;
          await m.save(existing);
        }
        if (!existing.user.name && p.name) {
          existing.user.name = p.name;
          await m.save(existing.user);
        }
        return existing.user;
      }
      let user =
        p.emailVerified && p.email
          ? await m.findOne(User, { where: { email: p.email } })
          : null;
      if (!user) {
        user = await m.save(
          m.create(User, {
            email: p.emailVerified && p.email ? p.email : null,
            name: p.name,
            lastSignInAt: null,
          }),
        );
      } else if (!user.name && p.name) {
        user.name = p.name;
        await m.save(user);
      }
      await m.save(
        m.create(Identity, {
          userId: user.id,
          provider,
          subject: p.subject,
          email: p.email,
        }),
      );
      return user;
    });
  }

  /** Make a session for a user. Also used by tests to sign someone in directly. */
  async signIn(user: User, userAgent = ''): Promise<SignedIn> {
    const token = `lga_${randomToken(32)}`;
    const now = Date.now();
    await this.sessions.save(
      this.sessions.create({
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: now + SESSION_TTL,
        lastUsedAt: now,
        userAgent: userAgent.slice(0, 300),
      }),
    );
    await this.users.update({ id: user.id }, { lastSignInAt: now });
    return { token, user: await this.view(user) };
  }

  /** Test helper and admin tool: sign in by verified email, creating the account if needed. */
  async signInByEmail(email: string, name = ''): Promise<SignedIn> {
    const user = await this.userForIdentity('email', {
      subject: email.toLowerCase(),
      email: email.toLowerCase(),
      emailVerified: true,
      name,
    });
    return this.signIn(user);
  }

  async userForToken(token: string): Promise<User | null> {
    if (!token.startsWith('lga_')) return null;
    const s = await this.sessions.findOne({
      where: { tokenHash: sha256(token) },
    });
    if (!s) return null;
    const now = Date.now();
    if (s.expiresAt < now) {
      await this.sessions.delete({ id: s.id });
      return null;
    }
    // Slide the expiry at most once a day.
    if (now - s.lastUsedAt > DAY)
      await this.sessions.update(
        { id: s.id },
        { lastUsedAt: now, expiresAt: now + SESSION_TTL },
      );
    return s.user;
  }

  async signOut(token: string): Promise<void> {
    await this.sessions.delete({ tokenHash: sha256(token) });
  }

  async deleteUser(userId: string): Promise<void> {
    await this.users.delete({ id: userId });
  }

  async rename(user: User, name: string): Promise<UserView> {
    user.name = name.trim().slice(0, 60);
    await this.users.save(user);
    return this.view(user);
  }

  async view(user: User): Promise<UserView> {
    const ids = await this.identities.find({
      where: { userId: user.id },
      order: { createdAt: 'ASC' },
    });
    return {
      id: user.id,
      name: user.name,
      email: user.email ?? ids.find((i) => i.email)?.email ?? '',
      signIns: ids.map((i) => ({ provider: i.provider, email: i.email })),
    };
  }
}
