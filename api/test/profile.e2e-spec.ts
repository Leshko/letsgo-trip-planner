import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { backfillProfiles } from '../src/auth/profile-backfill';
import { freshDatabase } from './db';
import { organizer } from './accounts';

interface Spot {
  token: string;
  member: { id: string; name: string; emoji: string; avatarUrl: string };
  trip: {
    id: string;
    inviteCode: string;
    members: { id: string; name: string; emoji: string; avatarUrl: string }[];
  };
}

const photo = () => {
  const bytes = randomBytes(700);
  return {
    bytes,
    dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
  };
};
const iso = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('one profile everywhere (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let ds: DataSource;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    await freshDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const account = () => organizer(app, `p-${randomUUID()}@example.com`);
  const create = async (
    acct: Record<string, string> | null,
    body: Record<string, unknown>,
  ) =>
    (
      await http
        .post('/api/trips')
        .set(acct ?? {})
        .send({
          name: 'Lake Week',
          startDate: iso(20),
          endDate: iso(24),
          ...body,
        })
        .expect(201)
    ).body as Spot;
  const join = (
    acct: Record<string, string> | null,
    code: string,
    body: Record<string, unknown> = {},
  ) =>
    http
      .post('/api/trips/join')
      .set(acct ?? {})
      .send({ code, ...body });
  const me = async (token: string) =>
    (await http.get('/api/trips/me').set(auth(token)).expect(200)).body
      .member as Spot['member'];
  const bytesOf = async (avatarUrl: string) =>
    (
      await http
        .get(avatarUrl)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200)
    ).body as Buffer;
  const profile = async (acct: Record<string, string>) =>
    (await http.get('/api/account').set(acct).expect(200)).body.profile as {
      name: string;
      emoji: string;
      avatarUrl: string;
    };

  it('a new account must give a name once; it becomes the profile', async () => {
    const acct = await account();
    await http
      .post('/api/trips')
      .set(acct)
      .send({ name: 'X', startDate: iso(1), endDate: iso(2) })
      .expect(400);
    expect(await profile(acct)).toEqual({ name: '', emoji: '', avatarUrl: '' });
    const a = await create(acct, { memberName: 'Jeremy', emoji: '🍕' });
    expect(a.member).toMatchObject({
      name: 'Jeremy',
      emoji: '🍕',
      avatarUrl: '',
    });
    expect(await profile(acct)).toEqual({
      name: 'Jeremy',
      emoji: '🍕',
      avatarUrl: '',
    });
  });

  it('starting something new reuses the name, emoji and photo without asking', async () => {
    const acct = await account();
    const a = await create(acct, { memberName: 'Jeremy', emoji: '🍕' });
    const p = photo();
    const withPhoto = await http
      .put('/api/trips/me/avatar')
      .set(auth(a.token))
      .send({ dataUrl: p.dataUrl })
      .expect(200);
    expect(withPhoto.body.avatarUrl).toContain(`/api/avatars/${a.member.id}`);

    // A gathering, created with no name at all.
    const g = await create(acct, {
      kind: 'gathering',
      name: 'Thanksgiving',
      startDate: iso(5),
      endDate: iso(5),
    });
    expect(g.member.name).toBe('Jeremy');
    expect(g.member.emoji).toBe('🍕');
    expect(g.member.avatarUrl).toContain(`/api/avatars/${g.member.id}`);
    expect((await bytesOf(g.member.avatarUrl)).equals(p.bytes)).toBe(true);
    expect((await profile(acct)).avatarUrl).not.toBe('');

    // An older copy of the app still sends a typed name: the profile wins.
    const old = await create(acct, { memberName: 'Someone Else', emoji: '🎈' });
    expect(old.member).toMatchObject({ name: 'Jeremy', emoji: '🍕' });
    expect((await bytesOf(old.member.avatarUrl)).equals(p.bytes)).toBe(true);
  });

  it('changing the photo, name or emoji in one place changes it everywhere', async () => {
    const acct = await account();
    const a = await create(acct, { memberName: 'Jeremy', emoji: '🍕' });
    const g = await create(acct, {
      kind: 'gathering',
      name: 'Thanksgiving',
      startDate: iso(5),
      endDate: iso(5),
    });
    expect(g.member.avatarUrl).toBe('');

    // Photo uploaded in the gathering shows on the trip.
    const p1 = photo();
    await http
      .put('/api/trips/me/avatar')
      .set(auth(g.token))
      .send({ dataUrl: p1.dataUrl })
      .expect(200);
    const a1 = await me(a.token);
    expect((await bytesOf(a1.avatarUrl)).equals(p1.bytes)).toBe(true);

    // A new photo on the trip: the gathering's link changes (so phones refetch) and serves it.
    const before = (await me(g.token)).avatarUrl;
    const p2 = photo();
    await http
      .put('/api/trips/me/avatar')
      .set(auth(a.token))
      .send({ dataUrl: p2.dataUrl })
      .expect(200);
    const g2 = await me(g.token);
    expect(g2.avatarUrl).not.toBe(before);
    expect((await bytesOf(g2.avatarUrl)).equals(p2.bytes)).toBe(true);

    // Name and emoji.
    await http
      .patch('/api/trips/me')
      .set(auth(g.token))
      .send({ name: 'Jer', emoji: '🎣' })
      .expect(200);
    expect(await me(a.token)).toMatchObject({ name: 'Jer', emoji: '🎣' });
    expect(await profile(acct)).toMatchObject({ name: 'Jer', emoji: '🎣' });
    // Everyone else in the trip sees it too.
    const view = await http
      .get(`/api/trips/${a.trip.id}`)
      .set(auth(a.token))
      .expect(200);
    expect(view.body.members[0]).toMatchObject({ name: 'Jer', emoji: '🎣' });

    // Removing the photo removes it everywhere.
    await http.delete('/api/trips/me/avatar').set(auth(a.token)).expect(200);
    expect((await me(g.token)).avatarUrl).toBe('');
    expect((await profile(acct)).avatarUrl).toBe('');
  });

  it('joining signed in needs no name, and takes over an unsaved spot with the same name', async () => {
    const host = await create(await account(), { memberName: 'Host' });
    const acct = await account();
    const mine = await create(acct, { memberName: 'Jeremy', emoji: '🍕' });
    const p = photo();
    await http
      .put('/api/trips/me/avatar')
      .set(auth(mine.token))
      .send({ dataUrl: p.dataUrl })
      .expect(200);

    const j = (await join(acct, host.trip.inviteCode).expect(201)).body as Spot;
    expect(j.member).toMatchObject({ name: 'Jeremy', emoji: '🍕' });
    expect((await bytesOf(j.member.avatarUrl)).equals(p.bytes)).toBe(true);
    // Joining again (a second scan) is the same spot.
    const again = (await join(acct, host.trip.inviteCode).expect(201))
      .body as Spot;
    expect(again.member.id).toBe(j.member.id);

    // Earlier they'd joined another trip without an account, as "jeremy": that spot becomes theirs.
    const other = await create(await account(), { memberName: 'Pat' });
    const unsaved = (
      await join(null, other.trip.inviteCode, { name: 'jeremy' }).expect(201)
    ).body as Spot;
    const taken = (await join(acct, other.trip.inviteCode).expect(201))
      .body as Spot;
    expect(taken.member.id).toBe(unsaved.member.id);
    expect(taken.member.name).toBe('Jeremy');
    expect(
      (await bytesOf((await me(unsaved.token)).avatarUrl)).equals(p.bytes),
    ).toBe(true);
  });

  it('when the name is taken in a trip, asks what to be called there', async () => {
    const hostAcct = await account();
    const host = await create(hostAcct, { memberName: 'Jeremy' });
    const acct = await account();
    const mine = await create(acct, { memberName: 'Jeremy', emoji: '🍕' });

    const clash = await join(acct, host.trip.inviteCode).expect(409);
    expect(clash.body.code).toBe('name_taken');
    expect(clash.body.message).toMatch(/already in this trip/);
    const j = (
      await join(acct, host.trip.inviteCode, { name: 'Jeremy L' }).expect(201)
    ).body as Spot;
    expect(j.member).toMatchObject({ name: 'Jeremy L', emoji: '🍕' });
    expect((await profile(acct)).name).toBe('Jeremy');

    // Renaming to something free everywhere brings that trip in line.
    await http
      .patch('/api/trips/me')
      .set(auth(mine.token))
      .send({ name: 'Jay' })
      .expect(200);
    expect((await me(j.token)).name).toBe('Jay');
    // Renaming to the host's name: refused where they are, kept apart where it clashes.
    await http
      .patch('/api/trips/me')
      .set(auth(j.token))
      .send({ name: 'jeremy' })
      .expect(400);
    await http
      .patch('/api/trips/me')
      .set(auth(mine.token))
      .send({ name: 'Jeremy' })
      .expect(200);
    expect((await me(mine.token)).name).toBe('Jeremy');
    expect((await me(j.token)).name).toBe('Jay');
  });

  it('saving an existing spot to an account fills the gaps in the profile', async () => {
    const host = await create(await account(), { memberName: 'Host' });
    // Grandma joined without an account, picked an emoji and a photo.
    const g = (
      await join(null, host.trip.inviteCode, {
        name: 'Grandma',
        emoji: '🧶',
      }).expect(201)
    ).body as Spot;
    const p = photo();
    await http
      .put('/api/trips/me/avatar')
      .set(auth(g.token))
      .send({ dataUrl: p.dataUrl })
      .expect(200);
    // She signs in: the spot becomes her profile.
    const acct = await account();
    await http
      .post('/api/account/claim')
      .set(acct)
      .send({ memberToken: g.token })
      .expect(200);
    expect(await profile(acct)).toMatchObject({ name: 'Grandma', emoji: '🧶' });
    // Her next gathering has it all.
    const next = await create(acct, {
      kind: 'gathering',
      name: 'Bingo',
      startDate: iso(3),
      endDate: iso(3),
    });
    expect(next.member).toMatchObject({ name: 'Grandma', emoji: '🧶' });
    expect((await bytesOf(next.member.avatarUrl)).equals(p.bytes)).toBe(true);

    // An account that already has a profile saves another spot: the profile wins there.
    const second = await create(await account(), { memberName: 'Host2' });
    const nana = (
      await join(null, second.trip.inviteCode, {
        name: 'Nana',
        emoji: '🌸',
      }).expect(201)
    ).body as Spot;
    await http
      .post('/api/account/claim')
      .set(acct)
      .send({ memberToken: nana.token })
      .expect(200);
    expect(await me(nana.token)).toMatchObject({
      name: 'Grandma',
      emoji: '🧶',
    });
    expect(
      (await bytesOf((await me(nana.token)).avatarUrl)).equals(p.bytes),
    ).toBe(true);
  });

  it('people without an account work as before', async () => {
    const host = await create(await account(), { memberName: 'Host' });
    await join(null, host.trip.inviteCode).expect(400);
    const a = (
      await join(null, host.trip.inviteCode, {
        name: 'Sam',
        emoji: '🎸',
      }).expect(201)
    ).body as Spot;
    const other = await create(await account(), { memberName: 'Host' });
    const b = (
      await join(null, other.trip.inviteCode, { name: 'Sam' }).expect(201)
    ).body as Spot;
    await http
      .patch('/api/trips/me')
      .set(auth(a.token))
      .send({ name: 'Sammy', emoji: '🥁' })
      .expect(200);
    await http
      .put('/api/trips/me/avatar')
      .set(auth(a.token))
      .send({ dataUrl: photo().dataUrl })
      .expect(200);
    expect(await me(b.token)).toMatchObject({
      name: 'Sam',
      emoji: '',
      avatarUrl: '',
    });
  });

  describe('catch-up for accounts from before profiles', () => {
    const wipeProfile = (userId: string) =>
      ds.query(
        `UPDATE app_user SET "profileName" = '', emoji = '', avatar = NULL, "avatarType" = '', "avatarVersion" = 0 WHERE id = $1`,
        [userId],
      );
    const userIdOf = async (memberId: string) =>
      (
        await ds.query<{ userId: string }[]>(
          `SELECT "userId" FROM member WHERE id = $1`,
          [memberId],
        )
      )[0].userId;

    it("fixes a gathering that got a pizza emoji instead of the trip's photo", async () => {
      // The trip came first and has the photo; the gathering was made later with a pizza.
      const acct = await account();
      const trip = await create(acct, { memberName: 'Jeremy' });
      const p = photo();
      await http
        .put('/api/trips/me/avatar')
        .set(auth(trip.token))
        .send({ dataUrl: p.dataUrl })
        .expect(200);
      const g = await create(acct, {
        kind: 'gathering',
        name: 'Thanksgiving',
        startDate: iso(5),
        endDate: iso(5),
      });
      const userId = await userIdOf(trip.member.id);
      // Put the rows back the way they were before profiles existed.
      await wipeProfile(userId);
      await ds.query(
        `UPDATE member SET emoji = '🍕', avatar = NULL, "avatarType" = '', "avatarVersion" = 0, "createdAt" = $2 WHERE id = $1`,
        [g.member.id, Date.now() + 1000],
      );
      await ds.query(`UPDATE member SET emoji = '' WHERE id = $1`, [
        trip.member.id,
      ]);
      expect((await me(g.token)).avatarUrl).toBe('');

      const done = await backfillProfiles((sql, params) =>
        ds.query(sql, params),
      );
      expect(done.accounts).toBeGreaterThanOrEqual(1);
      const fixed = await me(g.token);
      expect(fixed.avatarUrl).toContain(`/api/avatars/${g.member.id}`);
      expect((await bytesOf(fixed.avatarUrl)).equals(p.bytes)).toBe(true);
      expect(
        (await bytesOf((await me(trip.token)).avatarUrl)).equals(p.bytes),
      ).toBe(true);
      expect(await profile(acct)).toMatchObject({
        name: 'Jeremy',
        emoji: '🍕',
      });
      // Running it again changes nothing.
      const link = fixed.avatarUrl;
      await backfillProfiles((sql, params) => ds.query(sql, params));
      expect((await me(g.token)).avatarUrl).toBe(link);
    });

    it('with no photo anywhere uses the newest spot, and leaves clashing names alone', async () => {
      const acct = await account();
      const first = await create(acct, { memberName: 'Mike', emoji: '🚲' });
      const hostAcct = await account();
      const host = await create(hostAcct, { memberName: 'Mikey' });
      const second = (await join(acct, host.trip.inviteCode).expect(201))
        .body as Spot;
      const userId = await userIdOf(first.member.id);
      await wipeProfile(userId);
      // Before profiles: he was "Mike" on his trip and (newer) "Mikey B" with a guitar on the host's.
      await ds.query(
        `UPDATE member SET name = 'Mikey B', "nameKey" = 'mikey b', emoji = '🎸', "createdAt" = $2 WHERE id = $1`,
        [second.member.id, Date.now() + 1000],
      );
      await backfillProfiles((sql, params) => ds.query(sql, params));
      expect(await profile(acct)).toMatchObject({
        name: 'Mikey B',
        emoji: '🎸',
        avatarUrl: '',
      });
      expect(await me(first.token)).toMatchObject({
        name: 'Mikey B',
        emoji: '🎸',
      });

      // A clash: in another trip someone else is already "Mikey B".
      const clashHost = await create(await account(), {
        memberName: 'Mikey B',
      });
      const third = (
        await join(acct, clashHost.trip.inviteCode, { name: 'Michael' }).expect(
          201,
        )
      ).body as Spot;
      // Make sure the catch-up picks "Mikey B" (his newest spot), which is taken in this trip.
      await ds.query(`UPDATE member SET "createdAt" = $2 WHERE id = $1`, [
        third.member.id,
        Date.now() - 60_000,
      ]);
      await wipeProfile(userId);
      await backfillProfiles((sql, params) => ds.query(sql, params));
      expect((await profile(acct)).name).toBe('Mikey B');
      expect((await me(third.token)).name).toBe('Michael');
    });
  });
});
