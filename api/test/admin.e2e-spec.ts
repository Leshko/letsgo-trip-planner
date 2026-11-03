import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createECDH, randomBytes } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { freshDatabase } from './db';
import { organizer } from './accounts';

const KEY = 'test-admin-key-0123456789abcdef';

describe('admin screen (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const admin = { 'X-Admin-Key': KEY };

  beforeAll(async () => {
    delete process.env.ADMIN_KEY;
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
    delete process.env.ADMIN_KEY;
    await app.close();
  });

  it('is off until ADMIN_KEY is set, and too-short keys do not count', async () => {
    await http.get('/api/admin/trips').set(admin).expect(403);
    process.env.ADMIN_KEY = 'short';
    await http
      .get('/api/admin/trips')
      .set({ 'X-Admin-Key': 'short' })
      .expect(403);
    process.env.ADMIN_KEY = KEY;
    await http.get('/api/admin/check').set(admin).expect(200);
  });

  it('rejects wrong keys and slows down guessing', async () => {
    const ip = { 'CF-Connecting-IP': '198.51.100.9' };
    await http.get('/api/admin/trips').set(ip).expect(401);
    for (let i = 0; i < 9; i++)
      await http
        .get('/api/admin/trips')
        .set(ip)
        .set('X-Admin-Key', 'nope')
        .expect(401);
    await http.get('/api/admin/trips').set(ip).set(admin).expect(429);
    // Other addresses are unaffected.
    await http
      .get('/api/admin/trips')
      .set({ 'CF-Connecting-IP': '198.51.100.10' })
      .set(admin)
      .expect(200);
  });

  it('lists every trip with its invite code and who is in it', async () => {
    const a = await http
      .post('/api/trips')
      .set(await organizer(app))
      .send({
        name: 'Lake',
        startDate: '2027-07-01',
        endDate: '2027-07-05',
        memberName: 'Mom',
      })
      .expect(201);
    await http
      .post('/api/trips')
      .set(await organizer(app))
      .send({
        name: 'Ski',
        startDate: '2027-12-01',
        endDate: '2027-12-05',
        memberName: 'Pat',
      })
      .expect(201);
    await http
      .post('/api/trips/join')
      .send({ code: a.body.trip.inviteCode, name: 'Dad' })
      .expect(201);
    await http
      .post(`/api/trips/${a.body.trip.id}/ideas`)
      .set(auth(a.body.token))
      .send({ kind: 'activity', title: 'Kayak' })
      .expect(201);
    const list = await http.get('/api/admin/trips').set(admin).expect(200);
    expect(list.body.map((t: { name: string }) => t.name).sort()).toEqual([
      'Lake',
      'Ski',
    ]);
    const lake = list.body.find((t: { name: string }) => t.name === 'Lake');
    expect(lake.inviteCode).toBe(a.body.trip.inviteCode);
    expect(lake.counts).toMatchObject({ members: 2, ideas: 1 });
    const mom = lake.members.find((m: { name: string }) => m.name === 'Mom');
    expect(mom).toMatchObject({
      isOwner: true,
      counts: { ideas: 1, votes: 1 },
    });
    expect(lake.lastActivityAt).toBeTruthy();
  });

  it('merges a rejoined spot into the original one', async () => {
    const t = await http
      .post('/api/trips')
      .set(await organizer(app))
      .send({
        name: 'Beach',
        startDate: '2027-08-01',
        endDate: '2027-08-05',
        memberName: 'Mom',
      })
      .expect(201);
    const T = t.body.trip.id;
    const code = t.body.trip.inviteCode;
    const mom = t.body.token;
    const dad = await http
      .post('/api/trips/join')
      .send({ code, name: 'Dad', emoji: '🧔' })
      .expect(201);
    const kayak = await http
      .post(`/api/trips/${T}/ideas`)
      .set(auth(mom))
      .send({ kind: 'activity', title: 'Kayak' })
      .expect(201);
    const tacos = await http
      .post(`/api/trips/${T}/ideas`)
      .set(auth(mom))
      .send({ kind: 'food', title: 'Tacos' })
      .expect(201);
    await http
      .post(`/api/trips/${T}/ideas/${kayak.body.id}/vote`)
      .set(auth(dad.body.token))
      .expect(201);
    const post = await http
      .post(`/api/trips/${T}/posts`)
      .set(auth(mom))
      .send({ body: 'Who brings games?' })
      .expect(201);

    // Dad lost the trip on his phone and rejoined as "Dad 2".
    const dad2 = await http
      .post('/api/trips/join')
      .send({ code, name: 'Dad 2' })
      .expect(201);
    await http
      .post(`/api/trips/${T}/ideas/${kayak.body.id}/vote`)
      .set(auth(dad2.body.token))
      .expect(201);
    await http
      .post(`/api/trips/${T}/ideas/${tacos.body.id}/vote`)
      .set(auth(dad2.body.token))
      .expect(201);
    await http
      .post(`/api/trips/${T}/ideas/${tacos.body.id}/comments`)
      .set(auth(dad2.body.token))
      .send({ body: 'Yes please' })
      .expect(201);
    await http
      .post(`/api/trips/${T}/posts/${post.body.id}/react`)
      .set(auth(dad2.body.token))
      .send({ emoji: '🎲' })
      .expect(201);
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    await http
      .post('/api/trips/me/push')
      .set(auth(dad2.body.token))
      .send({
        endpoint: 'https://push.example/dad-new-phone',
        keys: {
          p256dh: ecdh.getPublicKey().toString('base64url'),
          auth: randomBytes(16).toString('base64url'),
        },
      })
      .expect(201);

    const r = await http
      .post(`/api/admin/trips/${T}/merge`)
      .set(admin)
      .send({
        fromMemberId: dad2.body.member.id,
        intoMemberId: dad.body.member.id,
      })
      .expect(200);
    expect(r.body.moved).toMatchObject({
      votes: 1,
      comments: 1,
      reactions: 1,
      'push devices': 1,
    });
    const kept = r.body.trip.members.find(
      (m: { id: string }) => m.id === dad.body.member.id,
    );
    expect(kept).toMatchObject({
      name: 'Dad',
      emoji: '🧔',
      mergedDevices: 1,
      counts: { votes: 2, comments: 1 },
    });
    expect(
      r.body.trip.members.map((m: { name: string }) => m.name).sort(),
    ).toEqual(['Dad', 'Mom']);

    // Dad's new phone now opens his original spot; any old phone still works too.
    const viaNew = await http
      .get('/api/trips/me')
      .set(auth(dad2.body.token))
      .expect(200);
    expect(viaNew.body.member.id).toBe(dad.body.member.id);
    await http.get('/api/trips/me').set(auth(dad.body.token)).expect(200);

    // One vote per idea, comment and reaction belong to Dad.
    const ideas = await http
      .get(`/api/trips/${T}/ideas`)
      .set(auth(mom))
      .expect(200);
    const k = ideas.body.find((i: { id: string }) => i.id === kayak.body.id);
    expect(k.voters.map((v: { name: string }) => v.name).sort()).toEqual([
      'Dad',
      'Mom',
    ]);
    const comments = await http
      .get(`/api/trips/${T}/ideas/${tacos.body.id}/comments`)
      .set(auth(mom))
      .expect(200);
    expect(comments.body[0].member.name).toBe('Dad');
    const posts = await http
      .get(`/api/trips/${T}/posts`)
      .set(auth(mom))
      .expect(200);
    expect(
      posts.body[0].reactions.find((x: { emoji: string }) => x.emoji === '🎲')
        .memberIds,
    ).toEqual([dad.body.member.id]);
    const [sub] = await app
      .get(DataSource)
      .query(
        `SELECT "memberId" FROM push_subscription WHERE endpoint = 'https://push.example/dad-new-phone'`,
      );
    expect(sub.memberId).toBe(dad.body.member.id);

    // The new device can keep voting as Dad.
    await http
      .post(`/api/trips/${T}/ideas/${kayak.body.id}/vote`)
      .set(auth(dad2.body.token))
      .expect(201);

    // The duplicate is gone.
    await http
      .post(`/api/admin/trips/${T}/merge`)
      .set(admin)
      .send({
        fromMemberId: dad2.body.member.id,
        intoMemberId: dad.body.member.id,
      })
      .expect(404);
  });

  it('refuses nonsense merges', async () => {
    const a = await http
      .post('/api/trips')
      .set(await organizer(app))
      .send({
        name: 'A',
        startDate: '2027-01-01',
        endDate: '2027-01-02',
        memberName: 'Ann',
      })
      .expect(201);
    const b = await http
      .post('/api/trips')
      .set(await organizer(app))
      .send({
        name: 'B',
        startDate: '2027-01-01',
        endDate: '2027-01-02',
        memberName: 'Bob',
      })
      .expect(201);
    await http
      .post(`/api/admin/trips/${a.body.trip.id}/merge`)
      .set(admin)
      .send({ fromMemberId: a.body.member.id, intoMemberId: a.body.member.id })
      .expect(400);
    await http
      .post(`/api/admin/trips/${a.body.trip.id}/merge`)
      .set(admin)
      .send({ fromMemberId: b.body.member.id, intoMemberId: a.body.member.id })
      .expect(404);
    await http
      .post(`/api/admin/trips/${a.body.trip.id}/merge`)
      .send({ fromMemberId: b.body.member.id, intoMemberId: a.body.member.id })
      .expect(401);
  });

  it('keeps the organizer role when merging an organizer duplicate', async () => {
    const t = await http
      .post('/api/trips')
      .set(await organizer(app))
      .send({
        name: 'Org',
        startDate: '2027-02-01',
        endDate: '2027-02-02',
        memberName: 'Mom',
      })
      .expect(201);
    const mom2 = await http
      .post('/api/trips/join')
      .send({ code: t.body.trip.inviteCode, name: 'Mommy' })
      .expect(201);
    // Merge the original organizer spot into the newer one: the kept spot becomes organizer.
    const r = await http
      .post(`/api/admin/trips/${t.body.trip.id}/merge`)
      .set(admin)
      .send({
        fromMemberId: t.body.member.id,
        intoMemberId: mom2.body.member.id,
      })
      .expect(200);
    expect(r.body.trip.members).toHaveLength(1);
    expect(r.body.trip.members[0]).toMatchObject({
      name: 'Mommy',
      isOwner: true,
    });
    const me = await http
      .get('/api/trips/me')
      .set(auth(t.body.token))
      .expect(200);
    expect(me.body.member.name).toBe('Mommy');
  });

  it('carries the account over, and refuses to merge two different accounts', async () => {
    const orgHeader = await organizer(app, 'kate@example.com');
    const t = await http
      .post('/api/trips')
      .set(orgHeader)
      .send({
        name: 'Acct',
        startDate: '2027-03-01',
        endDate: '2027-03-02',
        memberName: 'Kate',
      })
      .expect(201);
    const code = t.body.trip.inviteCode;
    // Grandpa joined without an account, lost it, and rejoined signed in as "Gramps".
    const gp = await http
      .post('/api/trips/join')
      .send({ code, name: 'Grandpa' })
      .expect(201);
    const gpHeader = await organizer(app, 'grandpa@example.com');
    const gramps = await http
      .post('/api/trips/join')
      .set(gpHeader)
      .send({ code, name: 'Gramps' })
      .expect(201);
    const r = await http
      .post(`/api/admin/trips/${t.body.trip.id}/merge`)
      .set(admin)
      .send({
        fromMemberId: gramps.body.member.id,
        intoMemberId: gp.body.member.id,
      })
      .expect(200);
    const kept = r.body.trip.members.find(
      (m: { id: string }) => m.id === gp.body.member.id,
    );
    expect(kept.account).toBe('grandpa@example.com');
    const mine = await http.get('/api/account').set(gpHeader).expect(200);
    expect(
      mine.body.trips.map((x: { member: { name: string } }) => x.member.name),
    ).toEqual(['Grandpa']);
    // Kate's spot and Grandpa's spot belong to different accounts.
    const refused = await http
      .post(`/api/admin/trips/${t.body.trip.id}/merge`)
      .set(admin)
      .send({ fromMemberId: gp.body.member.id, intoMemberId: t.body.member.id })
      .expect(409);
    expect(refused.body.message).toMatch(/different accounts/);
  });

  it('saves a spot to an email account, which then sees the trip after signing in', async () => {
    const t = await http
      .post('/api/trips')
      .set(await organizer(app))
      .send({
        name: 'Linked',
        startDate: '2027-04-01',
        endDate: '2027-04-02',
        memberName: 'Kate',
      })
      .expect(201);
    const T = t.body.trip.id;
    const tammy = await http
      .post('/api/trips/join')
      .send({ code: t.body.trip.inviteCode, name: 'Tammy' })
      .expect(201);
    const url = `/api/admin/trips/${T}/members/${tammy.body.member.id}/account`;
    const r = await http
      .post(url)
      .set(admin)
      .send({ email: 'Tammy@Example.com' })
      .expect(200);
    expect(
      r.body.members.find((m: { name: string }) => m.name === 'Tammy').account,
    ).toBe('tammy@example.com');
    const signed = await organizer(app, 'tammy@example.com');
    const mine = await http.get('/api/account').set(signed).expect(200);
    expect(
      mine.body.trips.map((x: { member: { name: string } }) => x.member.name),
    ).toEqual(['Tammy']);
    const me = await http
      .get('/api/trips/me')
      .set({ Authorization: `Bearer ${tammy.body.token}` })
      .expect(200);
    expect(me.body.accountLinked).toBe(true);
    await http
      .post(url)
      .set(admin)
      .send({ email: 'tammy@example.com' })
      .expect(200);
  });

  it('asks before moving a spot to a different account, and keeps one spot per account', async () => {
    const t = await http
      .post('/api/trips')
      .set(await organizer(app, 'kate@family.example'))
      .send({
        name: 'Swap',
        startDate: '2027-04-01',
        endDate: '2027-04-02',
        memberName: 'Kate',
      })
      .expect(201);
    const T = t.body.trip.id;
    const url = (id: string) => `/api/admin/trips/${T}/members/${id}/account`;
    const ask = await http
      .post(url(t.body.member.id))
      .set(admin)
      .send({ email: 'kate.new@example.com' })
      .expect(409);
    expect(ask.body.code).toBe('replace_needed');
    const moved = await http
      .post(url(t.body.member.id))
      .set(admin)
      .send({ email: 'kate.new@example.com', replace: true })
      .expect(200);
    expect(moved.body.members[0].account).toBe('kate.new@example.com');
    const [row] = await app
      .get(DataSource)
      .query(
        `SELECT u.email FROM trip t JOIN app_user u ON u.id = t."ownerUserId" WHERE t.id = $1`,
        [T],
      );
    expect(row.email).toBe('kate.new@example.com');
    const sam = await http
      .post('/api/trips/join')
      .send({ code: t.body.trip.inviteCode, name: 'Sam' })
      .expect(201);
    const dup = await http
      .post(url(sam.body.member.id))
      .set(admin)
      .send({ email: 'kate.new@example.com' })
      .expect(409);
    expect(dup.body.message).toMatch(/already Kate in this trip/);
    const off = await http.delete(url(t.body.member.id)).set(admin).expect(200);
    expect(
      off.body.members.find((m: { name: string }) => m.name === 'Kate').account,
    ).toBeNull();
    await http
      .post(url(sam.body.member.id))
      .set(admin)
      .send({ email: 'not-an-email' })
      .expect(400);
    await http
      .post(url(sam.body.member.id))
      .send({ email: 'x@example.com' })
      .expect(401);
  });
});
