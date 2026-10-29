import { INestApplication } from '@nestjs/common';
import { createECDH, randomBytes } from 'crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { devOutbox } from '../src/auth/mail.service';
import { MSA_TENANT } from '../src/auth/auth.config';
import { freshDatabase } from './db';
import { FakeOidc } from './fake-oidc';

const trip = (memberName: string) => ({
  name: 'Beach Week',
  startDate: '2027-08-01',
  endDate: '2027-08-05',
  memberName,
});

describe('accounts (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const google = new FakeOidc();
  const microsoft = new FakeOidc();
  const acct = (t: string) => ({ 'X-Account': t });
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    await google.start();
    await microsoft.start();
    microsoft.issuerTemplate = `${microsoft.issuer}/{tenantid}/v2.0`;
    Object.assign(process.env, {
      PUBLIC_URL: 'https://letsgo.example',
      GOOGLE_CLIENT_ID: google.clientId,
      GOOGLE_CLIENT_SECRET: 'g-secret',
      GOOGLE_ISSUER: google.issuer,
      MICROSOFT_CLIENT_ID: microsoft.clientId,
      MICROSOFT_CLIENT_SECRET: 'm-secret',
      MICROSOFT_ISSUER: microsoft.issuer,
    });
    await freshDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
    await google.stop();
    await microsoft.stop();
    for (const k of [
      'PUBLIC_URL',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_ISSUER',
      'MICROSOFT_CLIENT_ID',
      'MICROSOFT_CLIENT_SECRET',
      'MICROSOFT_ISSUER',
    ])
      delete process.env[k];
  });

  const lastMail = (to: string) =>
    [...devOutbox].reverse().find((m) => m.to === to)!;
  const codeIn = (to: string) => /\b(\d{6})\b/.exec(lastMail(to).subject)![1];
  const linkIn = (to: string) =>
    /\/auth\/email\?t=([A-Za-z0-9_-]+)/.exec(lastMail(to).text)![1];

  let ipN = 0;
  /** Each simulated visitor arrives through Cloudflare from their own address. */
  const visitor = () => ({
    'CF-Connecting-IP': `203.0.113.${(++ipN % 250) + 1}`,
  });

  async function emailSignIn(email: string): Promise<string> {
    const ip = visitor();
    await http
      .post('/api/auth/email/start')
      .set(ip)
      .send({ email })
      .expect(202);
    const r = await http
      .post('/api/auth/email/verify')
      .set(ip)
      .send({ email, code: codeIn(email) })
      .expect(200);
    return r.body.token as string;
  }

  /** Walk the browser through the provider and back, returning where the app lands. */
  async function providerSignIn(
    p: 'google' | 'microsoft',
    claims: Record<string, unknown>,
    opts: { returnTo?: string; tamper?: 'sig' | 'aud' | 'nonce' } = {},
  ): Promise<string> {
    const fake = p === 'google' ? google : microsoft;
    const start = await http
      .get(`/api/auth/${p}/start`)
      .query(opts.returnTo ? { returnTo: opts.returnTo } : {})
      .expect(302);
    const authorize = start.headers.location;
    expect(authorize.startsWith(`${fake.issuer}/authorize?`)).toBe(true);
    const u = new URL(authorize);
    expect(u.searchParams.get('redirect_uri')).toBe(
      `https://letsgo.example/api/auth/${p}/callback`,
    );
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    const { code, state } = fake.approve(authorize, claims, opts.tamper);
    const back = await http
      .get(`/api/auth/${p}/callback`)
      .query({ code, state })
      .expect(302);
    return back.headers.location;
  }

  async function exchange(
    location: string,
  ): Promise<{ token: string; user: { id: string; email: string } }> {
    const code = new URL(location, 'https://x').searchParams.get('code')!;
    const r = await http
      .post('/api/auth/exchange')
      .set(visitor())
      .send({ code })
      .expect(200);
    return r.body;
  }

  it('lists the sign-in options that are set up', async () => {
    const r = await http.get('/api/auth/providers').expect(200);
    expect(r.body).toEqual({ google: true, microsoft: true, email: true });
  });

  it('signs in with an emailed code, once', async () => {
    const ip = visitor();
    const email = 'Mom@Example.com';
    await http
      .post('/api/auth/email/start')
      .set(ip)
      .send({ email })
      .expect(202);
    const mail = lastMail('mom@example.com');
    expect(mail.text).toContain('https://letsgo.example/auth/email?t=');
    const code = codeIn('mom@example.com');
    const wrong = code === '000000' ? '111111' : '000000';
    await http
      .post('/api/auth/email/verify')
      .send({ email, code: wrong })
      .expect(400);
    const ok = await http
      .post('/api/auth/email/verify')
      .send({ email, code })
      .expect(200);
    expect(ok.body.user.email).toBe('mom@example.com');
    await http
      .post('/api/auth/email/verify')
      .set(ip)
      .send({ email, code })
      .expect(400);
    const me = await http
      .get('/api/account')
      .set(acct(ok.body.token))
      .expect(200);
    expect(me.body.trips).toEqual([]);
    expect(me.body.user.signIns).toEqual([
      { provider: 'email', email: 'mom@example.com' },
    ]);
  });

  it('signs in with the emailed link, and only the newest code works', async () => {
    const ip = visitor();
    const email = 'linky@example.com';
    await http
      .post('/api/auth/email/start')
      .set(ip)
      .send({ email })
      .expect(202);
    const oldCode = codeIn(email);
    await http
      .post('/api/auth/email/start')
      .set(ip)
      .send({ email })
      .expect(202);
    if (oldCode !== codeIn(email))
      await http
        .post('/api/auth/email/verify')
        .send({ email, code: oldCode })
        .expect(400);
    const r = await http
      .post('/api/auth/email/verify')
      .send({ token: linkIn(email) })
      .expect(200);
    expect(r.body.user.email).toBe(email);
    await http
      .post('/api/auth/email/verify')
      .send({ token: linkIn(email) })
      .expect(400);
  });

  it('locks a code after too many wrong guesses', async () => {
    const ip = visitor();
    const email = 'guesser@example.com';
    await http
      .post('/api/auth/email/start')
      .set(ip)
      .send({ email })
      .expect(202);
    const code = codeIn(email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await http
        .post('/api/auth/email/verify')
        .send({ email, code: wrong })
        .expect(400);
    await http
      .post('/api/auth/email/verify')
      .set(ip)
      .send({ email, code })
      .expect(429);
  });

  it('limits how fast one address can ask for codes', async () => {
    const ip = { 'CF-Connecting-IP': '198.51.100.7' };
    for (let i = 0; i < 10; i++)
      await http
        .post('/api/auth/email/start')
        .set(ip)
        .send({ email: `flood${i}@example.com` })
        .expect(202);
    await http
      .post('/api/auth/email/start')
      .set(ip)
      .send({ email: 'flood-x@example.com' })
      .expect(429);
    // Someone else is unaffected.
    await http
      .post('/api/auth/email/start')
      .set(visitor())
      .send({ email: 'calm@example.com' })
      .expect(202);
  });

  it('caps codes per address per hour', async () => {
    for (let i = 0; i < 5; i++)
      await http
        .post('/api/auth/email/start')
        .set(visitor())
        .send({ email: 'busy@example.com' })
        .expect(202);
    await http
      .post('/api/auth/email/start')
      .set(visitor())
      .send({ email: 'busy@example.com' })
      .expect(429);
  });

  it('rejects requests without a valid account session', async () => {
    await http.get('/api/account').expect(401);
    await http.get('/api/account').set(acct('lga_nope')).expect(401);
    await http.get('/api/account').set(acct('not-even-close')).expect(401);
  });

  it('requires an account to start a trip, and makes that account the owner', async () => {
    await http.post('/api/trips').send(trip('Mom')).expect(401);
    const token = await emailSignIn('organizer@example.com');
    const t = await http
      .post('/api/trips')
      .set(acct(token))
      .send(trip('Mom'))
      .expect(201);
    expect(t.body.member.isOwner).toBe(true);
    const me = await http.get('/api/account').set(acct(token)).expect(200);
    expect(me.body.trips).toHaveLength(1);
    expect(me.body.trips[0].trip.id).toBe(t.body.trip.id);
    expect(me.body.trips[0].token).toBe(t.body.token);
    const tm = await http
      .get('/api/trips/me')
      .set(bearer(t.body.token))
      .expect(200);
    expect(tm.body.accountLinked).toBe(true);
    const [row] = await app
      .get(DataSource)
      .query(`SELECT "ownerUserId" FROM trip WHERE id = $1`, [t.body.trip.id]);
    expect(row.ownerUserId).toBe(me.body.user.id);
  });

  it('lets people join without an account, but never hands over a signed-in spot', async () => {
    const org = await emailSignIn('org2@example.com');
    const t = await http
      .post('/api/trips')
      .set(acct(org))
      .send(trip('Mom'))
      .expect(201);
    const code = t.body.trip.inviteCode;

    const grandpa = await http
      .post('/api/trips/join')
      .send({ code, name: 'Grandpa' })
      .expect(201);
    const again = await http
      .post('/api/trips/join')
      .send({ code, name: 'grandpa' })
      .expect(201);
    expect(again.body.token).toBe(grandpa.body.token);
    const gm = await http
      .get('/api/trips/me')
      .set(bearer(grandpa.body.token))
      .expect(200);
    expect(gm.body.accountLinked).toBe(false);

    // Mom's spot is saved to an account: typing "Mom" with the code is refused.
    const takeover = await http
      .post('/api/trips/join')
      .send({ code, name: 'mom' })
      .expect(409);
    expect(takeover.body.message).toMatch(/signs in with an account/);

    // Signed in as Mom, the same link just opens her spot.
    const mine = await http
      .post('/api/trips/join')
      .set(acct(org))
      .send({ code, name: 'Whatever' })
      .expect(201);
    expect(mine.body.token).toBe(t.body.token);

    // A signed-in Grandpa joining by name picks up his old spot and saves it.
    const gp = await emailSignIn('grandpa@example.com');
    const linked = await http
      .post('/api/trips/join')
      .set(acct(gp))
      .send({ code, name: 'Grandpa' })
      .expect(201);
    expect(linked.body.token).toBe(grandpa.body.token);
    const list = await http.get('/api/account').set(acct(gp)).expect(200);
    expect(
      list.body.trips.map((x: { trip: { id: string } }) => x.trip.id),
    ).toEqual([t.body.trip.id]);

    // Someone else signed in can't take a saved name either.
    const other = await emailSignIn('impostor@example.com');
    await http
      .post('/api/trips/join')
      .set(acct(other))
      .send({ code, name: 'Grandpa' })
      .expect(409);
  });

  it('saves an existing spot (from before accounts) to an account, organizer included', async () => {
    const org = await emailSignIn('pre@example.com');
    const t = await http
      .post('/api/trips')
      .set(acct(org))
      .send(trip('Dad'))
      .expect(201);
    const ds = app.get(DataSource);
    // Make it look like a trip from before accounts existed.
    await ds.query(`UPDATE member SET "userId" = NULL WHERE "tripId" = $1`, [
      t.body.trip.id,
    ]);
    await ds.query(`UPDATE trip SET "ownerUserId" = NULL WHERE id = $1`, [
      t.body.trip.id,
    ]);
    const kid = await http
      .post('/api/trips/join')
      .send({ code: t.body.trip.inviteCode, name: 'Kid' })
      .expect(201);

    const dad = await emailSignIn('dad@example.com');
    const claimed = await http
      .post('/api/account/claim')
      .set(acct(dad))
      .send({ memberToken: t.body.token })
      .expect(200);
    expect(claimed.body.member.name).toBe('Dad');
    expect(claimed.body.token).toBe(t.body.token);
    const [row] = await ds.query(
      `SELECT "ownerUserId" FROM trip WHERE id = $1`,
      [t.body.trip.id],
    );
    const dadUser = (await http.get('/api/account').set(acct(dad))).body.user
      .id;
    expect(row.ownerUserId).toBe(dadUser);
    // Claiming twice is fine.
    await http
      .post('/api/account/claim')
      .set(acct(dad))
      .send({ memberToken: t.body.token })
      .expect(200);
    // Someone else can't take it.
    const other = await emailSignIn('other@example.com');
    await http
      .post('/api/account/claim')
      .set(acct(other))
      .send({ memberToken: t.body.token })
      .expect(409);
    // One account, one spot per trip.
    const dup = await http
      .post('/api/account/claim')
      .set(acct(dad))
      .send({ memberToken: kid.body.token })
      .expect(409);
    expect(dup.body.message).toMatch(/already in .* as Dad/);
    // Their old member token keeps working exactly as before.
    await http.get('/api/trips/me').set(bearer(t.body.token)).expect(200);
  });

  it('signs in with Google and lands on the requested page', async () => {
    const loc = await providerSignIn(
      'google',
      {
        sub: 'g-1',
        email: 'Kate@Gmail.com',
        email_verified: true,
        name: 'Kate',
      },
      { returnTo: '/trip/ideas/eat' },
    );
    expect(loc).toMatch(
      /^\/auth\/done\?code=[A-Za-z0-9_-]+&next=%2Ftrip%2Fideas%2Feat$/,
    );
    const s = await exchange(loc);
    expect(s.user.email).toBe('kate@gmail.com');
    // The handoff code is single use.
    const code = new URL(loc, 'https://x').searchParams.get('code');
    await http
      .post('/api/auth/exchange')
      .set(visitor())
      .send({ code })
      .expect(400);
    // Same Google account later: same user.
    const again = await exchange(
      await providerSignIn('google', {
        sub: 'g-1',
        email: 'kate@gmail.com',
        email_verified: true,
      }),
    );
    expect(again.user.id).toBe(s.user.id);
  });

  it('joins a verified Google address to the same email account', async () => {
    const viaEmail = await emailSignIn('same@example.com');
    const emailUser = (await http.get('/api/account').set(acct(viaEmail))).body
      .user;
    const g = await exchange(
      await providerSignIn('google', {
        sub: 'g-2',
        email: 'same@example.com',
        email_verified: true,
      }),
    );
    expect(g.user.id).toBe(emailUser.id);
    // An unverified address never matches.
    const u = await exchange(
      await providerSignIn('google', {
        sub: 'g-3',
        email: 'same@example.com',
        email_verified: false,
      }),
    );
    expect(u.user.id).not.toBe(emailUser.id);
  });

  it('signs in with Microsoft; only personal-account addresses match other sign-ins', async () => {
    const viaEmail = await emailSignIn('hotmail@outlook.com');
    const emailUser = (await http.get('/api/account').set(acct(viaEmail))).body
      .user;
    const personal = await exchange(
      await providerSignIn('microsoft', {
        sub: 's1',
        oid: 'o1',
        tid: MSA_TENANT,
        email: 'hotmail@outlook.com',
        name: 'Pat',
      }),
    );
    expect(personal.user.id).toBe(emailUser.id);
    // A work tenant could put any address on a user, so it gets its own account.
    const work = await exchange(
      await providerSignIn('microsoft', {
        sub: 's2',
        oid: 'o2',
        tid: '11111111-2222-3333-4444-555555555555',
        email: 'hotmail@outlook.com',
      }),
    );
    expect(work.user.id).not.toBe(emailUser.id);
  });

  it('rejects forged or mismatched provider tokens', async () => {
    for (const tamper of ['sig', 'aud', 'nonce'] as const) {
      const loc = await providerSignIn(
        'google',
        { sub: 'g-9', email: 'x@gmail.com', email_verified: true },
        { tamper },
      );
      expect(loc).toBe('/signin?error=failed');
    }
  });

  it('handles cancel, stale state and unsafe return paths', async () => {
    const start = await http.get('/api/auth/google/start').expect(302);
    const state = new URL(start.headers.location).searchParams.get('state');
    const cancelled = await http
      .get('/api/auth/google/callback')
      .query({ error: 'access_denied', state })
      .expect(302);
    expect(cancelled.headers.location).toBe('/signin?error=cancelled');
    // That state is used up now.
    const stale = await http
      .get('/api/auth/google/callback')
      .query({ code: 'x', state })
      .expect(302);
    expect(stale.headers.location).toBe('/signin?error=expired');
    const loc = await providerSignIn(
      'google',
      { sub: 'g-4', email: 'y@gmail.com', email_verified: true },
      { returnTo: '//evil.example/x' },
    );
    expect(loc).toMatch(/&next=%2Ftrips$/);
    await http
      .get('/api/auth/facebook/start')
      .expect(302)
      .expect('location', '/signin?error=unavailable');
  });

  it('tells the app its main web address', async () => {
    const r = await http.get('/api/config').expect(200);
    expect(r.body).toEqual({ publicUrl: 'https://letsgo.example' });
  });

  it('carries a signed-in account to the main address with a one-time code', async () => {
    const token = await emailSignIn('mover@example.com');
    const h = await http
      .post('/api/account/handoff')
      .set(acct(token))
      .expect(200);
    const moved = await http
      .post('/api/auth/exchange')
      .set(visitor())
      .send({ code: h.body.code })
      .expect(200);
    expect(moved.body.user.email).toBe('mover@example.com');
    expect(moved.body.token).not.toBe(token);
    await http
      .post('/api/auth/exchange')
      .set(visitor())
      .send({ code: h.body.code })
      .expect(400);
    await http.post('/api/account/handoff').expect(401);
  });

  it('turning notifications on at the main address replaces the old address', async () => {
    const org = await emailSignIn('pusher@example.com');
    const t = await http
      .post('/api/trips')
      .set(acct(org))
      .send(trip('Mom'))
      .expect(201);
    const keys = () => {
      const e = createECDH('prime256v1');
      e.generateKeys();
      return {
        p256dh: e.getPublicKey().toString('base64url'),
        auth: randomBytes(16).toString('base64url'),
      };
    };
    const ds = app.get(DataSource);
    const endpoints = async () =>
      ds.query<{ endpoint: string; origin: string }[]>(
        `SELECT endpoint, origin FROM push_subscription WHERE "memberId" = $1 ORDER BY endpoint`,
        [t.body.member.id],
      );
    await http
      .post('/api/trips/me/push')
      .set(bearer(t.body.token))
      .set('Origin', 'https://old.example')
      .send({ endpoint: 'https://push.example/a-old', keys: keys() })
      .expect(201);
    expect((await endpoints()).map((e) => e.origin)).toEqual([
      'https://old.example',
    ]);
    await http
      .post('/api/trips/me/push')
      .set(bearer(t.body.token))
      .set('Origin', 'https://letsgo.example')
      .send({ endpoint: 'https://push.example/b-new', keys: keys() })
      .expect(201);
    expect(await endpoints()).toEqual([
      {
        endpoint: 'https://push.example/b-new',
        origin: 'https://letsgo.example',
      },
    ]);
    // A second phone still on the old address doesn't knock out the new one.
    await http
      .post('/api/trips/me/push')
      .set(bearer(t.body.token))
      .set('Origin', 'https://old.example')
      .send({ endpoint: 'https://push.example/c-old', keys: keys() })
      .expect(201);
    expect((await endpoints()).map((e) => e.endpoint)).toEqual([
      'https://push.example/b-new',
      'https://push.example/c-old',
    ]);
  });

  it('signs out one device, and deleting an account keeps the trips', async () => {
    const a = await emailSignIn('leaver@example.com');
    const b = await emailSignIn('leaver@example.com');
    const t = await http
      .post('/api/trips')
      .set(acct(a))
      .send(trip('Leaver'))
      .expect(201);
    await http.post('/api/account/signout').set(acct(a)).expect(204);
    await http.get('/api/account').set(acct(a)).expect(401);
    await http.get('/api/account').set(acct(b)).expect(200);
    await http.delete('/api/account').set(acct(b)).expect(204);
    await http.get('/api/account').set(acct(b)).expect(401);
    const still = await http
      .get('/api/trips/me')
      .set(bearer(t.body.token))
      .expect(200);
    expect(still.body.trip.id).toBe(t.body.trip.id);
    expect(still.body.accountLinked).toBe(false);
  });
});

describe('sign-in options when nothing is set up (e2e)', () => {
  it('hides providers without PUBLIC_URL and credentials', async () => {
    const saved = process.env.MAIL_DEV_OUTBOX;
    delete process.env.MAIL_DEV_OUTBOX;
    await freshDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    try {
      const r = await request(app.getHttpServer())
        .get('/api/auth/providers')
        .expect(200);
      expect(r.body).toEqual({ google: false, microsoft: false, email: false });
      await request(app.getHttpServer())
        .post('/api/auth/email/start')
        .send({ email: 'a@b.co' })
        .expect(503);
    } finally {
      await app.close();
      process.env.MAIL_DEV_OUTBOX = saved;
    }
  });
});
