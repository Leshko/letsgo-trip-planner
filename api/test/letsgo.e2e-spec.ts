import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { existsSync } from 'fs';
import { join } from 'path';
import { photosDir } from '../src/common/paths';

describe('LetsGo API (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let tripId: string;
  let code: string;
  let momToken: string;
  let dadToken: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => app.close());

  it('creates a trip and returns the owner session', async () => {
    const res = await http
      .post('/api/trips')
      .send({
        name: 'Lake Week',
        destination: 'Lake Tahoe',
        startDate: '2027-07-10',
        endDate: '2027-07-13',
        memberName: 'Mom',
        emoji: '🌞',
      })
      .expect(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.member.isOwner).toBe(true);
    expect(res.body.member.emoji).toBe('🌞');
    expect(res.body.trip.inviteCode).toMatch(/^[A-Z2-9]{6}$/);
    tripId = res.body.trip.id;
    code = res.body.trip.inviteCode;
    momToken = res.body.token;
  });

  it('rejects an end date before the start date', async () => {
    await http
      .post('/api/trips')
      .send({
        name: 'Bad',
        startDate: '2027-07-10',
        endDate: '2027-07-01',
        memberName: 'X',
      })
      .expect(400);
  });

  it('lets a family member join with the code (case/spacing insensitive)', async () => {
    const res = await http
      .post('/api/trips/join')
      .send({ code: ` ${code.toLowerCase()} `, name: 'Dad' })
      .expect(201);
    expect(res.body.trip.id).toBe(tripId);
    expect(res.body.member.isOwner).toBe(false);
    expect(res.body.trip.members.map((m: { name: string }) => m.name)).toEqual([
      'Mom',
      'Dad',
    ]);
    dadToken = res.body.token;
  });

  it('hands the same identity back when the same name rejoins', async () => {
    const res = await http
      .post('/api/trips/join')
      .send({ code, name: 'dad' })
      .expect(201);
    expect(res.body.token).toBe(dadToken);
  });

  it('404s on an unknown code and 401s without a token', async () => {
    await http
      .post('/api/trips/join')
      .send({ code: 'ZZZZZZ', name: 'Nobody' })
      .expect(404);
    await http.get('/api/trips/me').expect(401);
    await http.get(`/api/trips/${tripId}`).set(auth('nope')).expect(401);
  });

  it('resolves /me from a token', async () => {
    const res = await http.get('/api/trips/me').set(auth(dadToken)).expect(200);
    expect(res.body.member.name).toBe('Dad');
    expect(res.body.trip.id).toBe(tripId);
  });

  it('blocks members of another trip', async () => {
    const other = await http
      .post('/api/trips')
      .send({
        name: 'Other',
        startDate: '2027-01-01',
        endDate: '2027-01-02',
        memberName: 'Stranger',
      })
      .expect(201);
    await http
      .get(`/api/trips/${tripId}`)
      .set(auth(other.body.token))
      .expect(403);
  });

  let kayakId: string;
  let tacoId: string;

  it('adds ideas; the suggester auto-votes', async () => {
    const k = await http
      .post(`/api/trips/${tripId}/ideas`)
      .set(auth(momToken))
      .send({
        kind: 'activity',
        title: 'Kayaking',
        cost: '$$',
        link: 'https://example.com',
      })
      .expect(201);
    expect(k.body.voteCount).toBe(1);
    expect(k.body.votedByMe).toBe(true);
    expect(k.body.suggestedBy.name).toBe('Mom');
    kayakId = k.body.id;

    const t = await http
      .post(`/api/trips/${tripId}/ideas`)
      .set(auth(dadToken))
      .send({ kind: 'food', title: 'Taco Truck' })
      .expect(201);
    tacoId = t.body.id;

    await http
      .post(`/api/trips/${tripId}/ideas`)
      .set(auth(dadToken))
      .send({ kind: 'nope', title: 'x' })
      .expect(400);
  });

  it('toggles votes and sorts by votes', async () => {
    const up = await http
      .post(`/api/trips/${tripId}/ideas/${kayakId}/vote`)
      .set(auth(dadToken))
      .expect(201);
    expect(up.body.voteCount).toBe(2);
    expect(up.body.voters.map((v: { name: string }) => v.name).sort()).toEqual([
      'Dad',
      'Mom',
    ]);

    const list = await http
      .get(`/api/trips/${tripId}/ideas`)
      .set(auth(momToken))
      .expect(200);
    expect(list.body[0].title).toBe('Kayaking');
    expect(list.body[1].title).toBe('Taco Truck');

    const down = await http
      .post(`/api/trips/${tripId}/ideas/${kayakId}/vote`)
      .set(auth(dadToken))
      .expect(201);
    expect(down.body.voteCount).toBe(1);

    const food = await http
      .get(`/api/trips/${tripId}/ideas?kind=food`)
      .set(auth(momToken))
      .expect(200);
    expect(food.body).toHaveLength(1);
  });

  it('supports comments on ideas', async () => {
    await http
      .post(`/api/trips/${tripId}/ideas/${kayakId}/comments`)
      .set(auth(dadToken))
      .send({ body: 'Only if the water is warm' })
      .expect(201);
    const comments = await http
      .get(`/api/trips/${tripId}/ideas/${kayakId}/comments`)
      .set(auth(momToken))
      .expect(200);
    expect(comments.body).toHaveLength(1);
    expect(comments.body[0].member.name).toBe('Dad');

    const list = await http
      .get(`/api/trips/${tripId}/ideas`)
      .set(auth(momToken))
      .expect(200);
    expect(
      list.body.find((i: { id: string }) => i.id === kayakId).commentCount,
    ).toBe(1);
  });

  it('only the suggester or owner can delete an idea', async () => {
    const stranger = await http
      .post('/api/trips/join')
      .send({ code, name: 'Cousin' })
      .expect(201);
    await http
      .delete(`/api/trips/${tripId}/ideas/${tacoId}`)
      .set(auth(stranger.body.token))
      .expect(403);
    await http
      .delete(`/api/trips/${tripId}/ideas/${tacoId}`)
      .set(auth(momToken))
      .expect(204);
  });

  it('runs the wall: posts and reactions', async () => {
    const p = await http
      .post(`/api/trips/${tripId}/posts`)
      .set(auth(momToken))
      .send({ body: 'Who is bringing the cooler?' })
      .expect(201);
    const r1 = await http
      .post(`/api/trips/${tripId}/posts/${p.body.id}/react`)
      .set(auth(dadToken))
      .send({ emoji: '🙋' })
      .expect(201);
    expect(r1.body.reactions).toEqual([
      { emoji: '🙋', count: 1, memberIds: expect.any(Array), mine: true },
    ]);
    const r2 = await http
      .post(`/api/trips/${tripId}/posts/${p.body.id}/react`)
      .set(auth(dadToken))
      .send({ emoji: '🙋' })
      .expect(201);
    expect(r2.body.reactions).toEqual([]);
    const wall = await http
      .get(`/api/trips/${tripId}/posts`)
      .set(auth(dadToken))
      .expect(200);
    expect(wall.body[0].member.name).toBe('Mom');
  });

  it('builds an itinerary with every trip day present', async () => {
    const empty = await http
      .get(`/api/trips/${tripId}/itinerary`)
      .set(auth(momToken))
      .expect(200);
    expect(empty.body.map((d: { date: string }) => d.date)).toEqual([
      '2027-07-10',
      '2027-07-11',
      '2027-07-12',
      '2027-07-13',
    ]);

    const fromIdea = await http
      .post(`/api/trips/${tripId}/itinerary`)
      .set(auth(dadToken))
      .send({ date: '2027-07-11', ideaId: kayakId, startTime: '14:00' })
      .expect(201);
    expect(fromIdea.body.title).toBe('Kayaking');
    expect(fromIdea.body.idea.id).toBe(kayakId);

    const custom = await http
      .post(`/api/trips/${tripId}/itinerary`)
      .set(auth(momToken))
      .send({
        date: '2027-07-11',
        title: 'Breakfast at the cabin',
        startTime: '08:30',
      })
      .expect(201);

    await http
      .post(`/api/trips/${tripId}/itinerary`)
      .set(auth(momToken))
      .send({ date: '2027-07-11' })
      .expect(400);

    const days = await http
      .get(`/api/trips/${tripId}/itinerary`)
      .set(auth(momToken))
      .expect(200);
    const day = days.body.find(
      (d: { date: string }) => d.date === '2027-07-11',
    );
    expect(day.entries.map((e: { title: string }) => e.title)).toEqual([
      'Breakfast at the cabin',
      'Kayaking',
    ]);

    const moved = await http
      .put(`/api/trips/${tripId}/itinerary/reorder`)
      .set(auth(momToken))
      .send({ date: '2027-07-12', entryIds: [custom.body.id] })
      .expect(200);
    expect(
      moved.body.find((d: { date: string }) => d.date === '2027-07-12').entries,
    ).toHaveLength(1);
    expect(
      moved.body.find((d: { date: string }) => d.date === '2027-07-11').entries,
    ).toHaveLength(1);

    await http
      .delete(`/api/trips/${tripId}/itinerary/${custom.body.id}`)
      .set(auth(momToken))
      .expect(204);
  });

  it('stores lodging and shows it in the trip', async () => {
    const res = await http
      .put(`/api/trips/${tripId}/lodging`)
      .set(auth(momToken))
      .send({
        name: 'Pine Cabin',
        address: '1 Lakeshore Dr, Tahoe City, CA',
        checkIn: '4pm',
        photos: ['https://example.com/a.jpg', ' '],
      })
      .expect(200);
    expect(res.body.lodging.name).toBe('Pine Cabin');
    expect(res.body.lodging.photos).toEqual(['https://example.com/a.jpg']);
  });

  it('records a readable activity feed', async () => {
    const feed = await http
      .get(`/api/trips/${tripId}/activity`)
      .set(auth(momToken))
      .expect(200);
    const lines = feed.body.map(
      (a: { member: { name: string }; message: string }) =>
        `${a.member.name} ${a.message}`,
    );
    expect(lines).toEqual(
      expect.arrayContaining([
        'Mom started planning Lake Week',
        'Dad joined the trip',
        'Mom suggested Kayaking',
        'Dad wants to eat at Taco Truck',
        'Dad is in for Kayaking',
        'Dad commented on Kayaking',
        "Mom updated where we're staying: Pine Cabin",
      ]),
    );
    expect(lines[0]).toBe("Mom updated where we're staying: Pine Cabin");
  });

  it('updates a profile', async () => {
    const res = await http
      .patch('/api/trips/me')
      .set(auth(dadToken))
      .send({ emoji: '🎣' })
      .expect(200);
    expect(res.body.emoji).toBe('🎣');
    await http
      .patch('/api/trips/me')
      .set(auth(dadToken))
      .send({ name: 'mom' })
      .expect(400);
  });
});

describe('unfurl endpoint (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let auth: { Authorization: string };
  let tripId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    const res = await http
      .post('/api/trips')
      .send({
        name: 'U',
        startDate: '2027-01-01',
        endDate: '2027-01-02',
        memberName: 'Me',
      })
      .expect(201);
    auth = { Authorization: `Bearer ${res.body.token}` };
    tripId = res.body.trip.id;
  });

  afterAll(async () => app.close());

  it('requires a member and refuses private or malformed links', async () => {
    await http.get('/api/trips/x/unfurl?url=https://example.com').expect(401);
    const bad = [
      '',
      'ftp://example.com/x',
      'http://127.0.0.1:3001/',
      'http://192.168.86.113/',
      'http://localhost/',
    ];
    for (const url of bad) {
      await http
        .get(`/api/trips/${tripId}/unfurl?url=${encodeURIComponent(url)}`)
        .set(auth)
        .expect(400);
    }
  });

  it('stores an image on an idea and drops non-http ones', async () => {
    const ok = await http
      .post(`/api/trips/${tripId}/ideas`)
      .set(auth)
      .send({
        kind: 'activity',
        title: 'Zip line',
        imageUrl: 'https://cdn.example.com/zip.jpg',
        siteName: 'Zip Co',
      })
      .expect(201);
    expect(ok.body.imageUrl).toBe('https://cdn.example.com/zip.jpg');
    expect(ok.body.siteName).toBe('Zip Co');
    const bad = await http
      .post(`/api/trips/${tripId}/ideas`)
      .set(auth)
      .send({ kind: 'activity', title: 'Bad', imageUrl: 'javascript:alert(1)' })
      .expect(201);
    expect(bad.body.imageUrl).toBe('');
  });
});

describe('idea details, editing and login codes (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let auth: { Authorization: string };
  let tripId: string;
  let memberId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    const res = await http
      .post('/api/trips')
      .send({
        name: 'E',
        startDate: '2027-01-01',
        endDate: '2027-01-02',
        memberName: 'Owner',
      })
      .expect(201);
    auth = { Authorization: `Bearer ${res.body.token}` };
    tripId = res.body.trip.id;
    memberId = res.body.member.id;
  });

  afterAll(async () => app.close());

  it('creates and edits an idea with details; anyone in the trip can edit', async () => {
    const created = await http
      .post(`/api/trips/${tripId}/ideas`)
      .set(auth)
      .send({
        kind: 'activity',
        title: 'Zoo',
        details: [
          { label: 'Hours', value: '9–5' },
          { label: ' ', value: 'x' },
        ],
      })
      .expect(201);
    expect(created.body.details).toEqual([{ label: 'Hours', value: '9–5' }]);

    const trip = await http.get(`/api/trips/${tripId}`).set(auth).expect(200);
    const other = await http
      .post('/api/trips/join')
      .send({ code: trip.body.inviteCode, name: 'Kid' })
      .expect(201);
    const edited = await http
      .patch(`/api/trips/${tripId}/ideas/${created.body.id}`)
      .set({ Authorization: `Bearer ${other.body.token}` })
      .send({
        title: 'City Zoo',
        cost: '$$',
        details: [
          { label: 'Hours', value: '9–5' },
          { label: 'Tickets', value: '$18 adults' },
        ],
      })
      .expect(200);
    expect(edited.body.title).toBe('City Zoo');
    expect(edited.body.cost).toBe('$$');
    expect(edited.body.details).toHaveLength(2);

    await http
      .patch(`/api/trips/${tripId}/ideas/${created.body.id}`)
      .set(auth)
      .send({ details: [{ label: 'x' }] })
      .expect(400);

    const feed = await http
      .get(`/api/trips/${tripId}/activity`)
      .set(auth)
      .expect(200);
    expect(feed.body[0].message).toBe('updated City Zoo');
  });

  it('moves a session to another device with a single-use login code', async () => {
    const made = await http
      .post('/api/trips/me/transfer-code')
      .set(auth)
      .expect(201);
    expect(made.body.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(made.body.expiresAt).toBeGreaterThan(Date.now());

    const redeemed = await http
      .post('/api/trips/transfer')
      .send({ code: made.body.code.toLowerCase() })
      .expect(201);
    expect(redeemed.body.member.id).toBe(memberId);
    expect(redeemed.body.trip.id).toBe(tripId);
    expect(redeemed.body.token).toBe(auth.Authorization.slice(7));

    // second use fails; a fresh code replaces an unused older one
    await http
      .post('/api/trips/transfer')
      .send({ code: made.body.code })
      .expect(404);
    const a = await http
      .post('/api/trips/me/transfer-code')
      .set(auth)
      .expect(201);
    const b = await http
      .post('/api/trips/me/transfer-code')
      .set(auth)
      .expect(201);
    await http
      .post('/api/trips/transfer')
      .send({ code: a.body.code })
      .expect(404);
    await http
      .post('/api/trips/transfer')
      .send({ code: b.body.code })
      .expect(201);
    await http.post('/api/trips/me/transfer-code').expect(401);
  });

  it('rate-limits code guessing', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const r = await http
        .post('/api/trips/transfer')
        .send({ code: 'NOPE' + i });
      last = r.status;
    }
    expect(last).toBe(429);
  });
});

describe('profile photos (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let auth: { Authorization: string };
  let memberId: string;
  // 1x1 PNG padded with a comment-free zero buffer so it clears the minimum size
  const png = Buffer.concat([
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    ),
    Buffer.alloc(200),
  ]);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    const res = await http
      .post('/api/trips')
      .send({
        name: 'P',
        startDate: '2027-01-01',
        endDate: '2027-01-02',
        memberName: 'Pic',
      })
      .expect(201);
    auth = { Authorization: `Bearer ${res.body.token}` };
    memberId = res.body.member.id;
    expect(res.body.member.avatarUrl).toBe('');
  });

  afterAll(async () => app.close());

  it('uploads, serves, versions and removes a photo', async () => {
    const up = await http
      .put('/api/trips/me/avatar')
      .set(auth)
      .send({ dataUrl: 'data:image/png;base64,' + png.toString('base64') })
      .expect(200);
    expect(up.body.avatarUrl).toBe(`/api/avatars/${memberId}?v=1`);

    const img = await http.get(`/api/avatars/${memberId}`).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(img.body as Buffer, png)).toBe(0);

    const me = await http.get('/api/trips/me').set(auth).expect(200);
    expect(me.body.member.avatarUrl).toContain('?v=1');
    expect(me.body.trip.members[0].avatarUrl).toContain('?v=1');

    const again = await http
      .put('/api/trips/me/avatar')
      .set(auth)
      .send({ dataUrl: 'data:image/png;base64,' + png.toString('base64') })
      .expect(200);
    expect(again.body.avatarUrl).toContain('?v=2');

    await http
      .put('/api/trips/me/avatar')
      .set(auth)
      .send({ dataUrl: 'data:text/html;base64,PGI+' })
      .expect(400);
    await http
      .put('/api/trips/me/avatar')
      .set(auth)
      .send({
        dataUrl:
          'data:image/png;base64,' + Buffer.alloc(300_000).toString('base64'),
      })
      .expect(400);

    const gone = await http
      .delete('/api/trips/me/avatar')
      .set(auth)
      .expect(200);
    expect(gone.body.avatarUrl).toBe('');
    await http.get(`/api/avatars/${memberId}`).expect(404);
  });
});

describe('shared photos (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: { Authorization: string };
  let kid: { Authorization: string };
  let stranger: { Authorization: string };
  let ownerToken: string;
  let tripId: string;
  let inviteCode: string;
  // tiny real PNG and a minimal JPEG header (sniffed by magic bytes only)
  const png = Buffer.concat([
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    ),
    Buffer.alloc(300),
  ]);
  const jpg = Buffer.concat([
    Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    ]),
    Buffer.alloc(200),
    Buffer.from([0xff, 0xd9]),
  ]);
  const binary = (
    res: request.Response,
    cb: (err: Error | null, body: Buffer) => void,
  ) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    const res = await http
      .post('/api/trips')
      .send({
        name: 'Photo: Trip/2027',
        startDate: '2027-01-01',
        endDate: '2027-01-02',
        memberName: 'Owner',
      })
      .expect(201);
    ownerToken = res.body.token;
    owner = { Authorization: `Bearer ${ownerToken}` };
    tripId = res.body.trip.id;
    inviteCode = res.body.trip.inviteCode;
    const k = await http
      .post('/api/trips/join')
      .send({ code: inviteCode, name: 'Kid' })
      .expect(201);
    kid = { Authorization: `Bearer ${k.body.token}` };
    const s = await http
      .post('/api/trips')
      .send({
        name: 'Other',
        startDate: '2027-01-01',
        endDate: '2027-01-02',
        memberName: 'S',
      })
      .expect(201);
    stranger = { Authorization: `Bearer ${s.body.token}` };
  });

  afterAll(async () => app.close());

  let first: string;
  let second: string;
  const batch = 'batch-0001-aaaa';

  it('uploads originals with and without derivatives', async () => {
    const a = await http
      .post(`/api/trips/${tripId}/photos`)
      .set(owner)
      .field('batchId', batch)
      .field('caption', 'Beach day')
      .field('width', '1')
      .field('height', '1')
      .attach('original', png, {
        filename: 'IMG_0001.png',
        contentType: 'image/png',
      })
      .attach('thumb', jpg, { filename: 't.jpg', contentType: 'image/jpeg' })
      .expect(201);
    expect(a.body.hasThumb).toBe(true);
    expect(a.body.hasPreview).toBe(false);
    expect(a.body.urls.thumb).toBe(`/api/photo-files/${a.body.id}/thumb`);
    expect(a.body.caption).toBe('Beach day');
    expect(a.body.mimeType).toBe('image/png');
    expect(a.body.width).toBe(1);
    expect(a.body.uploadedBy.name).toBe('Owner');
    first = a.body.id;

    const b = await http
      .post(`/api/trips/${tripId}/photos`)
      .set(kid)
      .field('batchId', batch)
      .attach('original', png, {
        filename: 'IMG_0002.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect(b.body.hasThumb).toBe(false);
    expect(b.body.urls.thumb).toBeNull();
    second = b.body.id;
    expect(existsSync(join(photosDir(), tripId, `${second}.png`))).toBe(true);
  });

  it('rejects non-images and empty uploads', async () => {
    await http
      .post(`/api/trips/${tripId}/photos`)
      .set(owner)
      .field('batchId', batch)
      .attach('original', Buffer.from('hello world, definitely not an image'), {
        filename: 'x.png',
        contentType: 'image/png',
      })
      .expect(400);
    await http
      .post(`/api/trips/${tripId}/photos`)
      .set(owner)
      .field('batchId', batch)
      .expect(400);
    await http
      .post(`/api/trips/${tripId}/photos`)
      .set(stranger)
      .field('batchId', batch)
      .attach('original', png, 'a.png')
      .expect(403);
  });

  it('lists newest first and serves files with cache headers', async () => {
    const list = await http
      .get(`/api/trips/${tripId}/photos`)
      .set(kid)
      .expect(200);
    expect(list.body.map((p: { id: string }) => p.id)).toEqual([second, first]);
    expect(list.body[1].commentCount).toBe(0);

    const img = await http
      .get(`/api/photo-files/${first}/original`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(img.headers['content-type']).toContain('image/png');
    expect(img.headers['cache-control']).toContain('immutable');
    expect(Buffer.compare(img.body as Buffer, png)).toBe(0);
    const dl = await http
      .get(`/api/photo-files/${first}/original?download=1`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(dl.headers['content-disposition']).toContain('attachment');
    expect(dl.headers['content-disposition']).toContain('IMG_0001.png');
    const th = await http
      .get(`/api/photo-files/${first}/thumb`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(th.headers['content-type']).toContain('image/jpeg');
    await http.get(`/api/photo-files/${second}/thumb`).expect(404);
    await http.get(`/api/photo-files/${first}/nope`).expect(404);
    await http.get(`/api/photo-files/not-a-uuid/original`).expect(404);
  });

  it('comments with ownership rules and counts', async () => {
    const c = await http
      .post(`/api/trips/${tripId}/photos/${first}/comments`)
      .set(kid)
      .send({ body: 'Love this' })
      .expect(201);
    expect(c.body.member.name).toBe('Kid');
    const list = await http
      .get(`/api/trips/${tripId}/photos/${first}/comments`)
      .set(owner)
      .expect(200);
    expect(list.body).toHaveLength(1);
    const photos = await http
      .get(`/api/trips/${tripId}/photos`)
      .set(owner)
      .expect(200);
    expect(
      photos.body.find((p: { id: string }) => p.id === first).commentCount,
    ).toBe(1);
    const other = await http
      .post('/api/trips/join')
      .send({ code: inviteCode, name: 'Aunt' })
      .expect(201);
    await http
      .delete(`/api/trips/${tripId}/photo-comments/${c.body.id}`)
      .set({ Authorization: `Bearer ${other.body.token}` })
      .expect(403);
    await http
      .delete(`/api/trips/${tripId}/photo-comments/${c.body.id}`)
      .set(kid)
      .expect(204);
  });

  it('writes one feed line per batch plus comment lines', async () => {
    const feed = await http
      .get(`/api/trips/${tripId}/activity`)
      .set(owner)
      .expect(200);
    const lines = feed.body.map(
      (a: { member: { name: string }; message: string; type: string }) =>
        `${a.type}|${a.member.name} ${a.message}`,
    );
    expect(lines.filter((l: string) => l.startsWith('photo|'))).toEqual([
      'photo|Kid added a photo',
      'photo|Owner added a photo',
    ]);
    expect(lines).toContain('comment|Kid commented on a photo');
  });

  it('caption edits are limited to uploader or owner', async () => {
    await http
      .patch(`/api/trips/${tripId}/photos/${first}`)
      .set(kid)
      .send({ caption: 'nope' })
      .expect(403);
    const ok = await http
      .patch(`/api/trips/${tripId}/photos/${second}`)
      .set(owner)
      .send({ caption: 'Owner can' })
      .expect(200);
    expect(ok.body.caption).toBe('Owner can');
  });

  it('streams a zip only with a token on GET', async () => {
    await http.get(`/api/trips/${tripId}/photos.zip`).expect(401);
    await http
      .get(
        `/api/trips/${tripId}/photos.zip?token=${stranger.Authorization.slice(7)}`,
      )
      .expect(403);
    await http
      .post(`/api/trips/${tripId}/photos?token=${ownerToken}`)
      .field('batchId', batch)
      .expect(401);

    const zip = await http
      .get(`/api/trips/${tripId}/photos.zip?token=${ownerToken}`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(zip.headers['content-type']).toContain('application/zip');
    expect(zip.headers['content-disposition']).toContain(
      'LetsGo - Photo Trip2027.zip',
    );
    const body = zip.body as Buffer;
    expect(body.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(body.length).toBeGreaterThan(png.length * 2);
    const eocd = body.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(eocd).toBeGreaterThan(0);
    expect(body.readUInt16LE(eocd + 10)).toBe(2);
    expect(body.includes(Buffer.from('001-Owner-IMG_0001.png'))).toBe(true);
    expect(body.includes(Buffer.from('002-Kid-IMG_0002.png'))).toBe(true);
  });

  it('deletes with permission checks and removes files', async () => {
    await http
      .post(`/api/trips/${tripId}/photos/${second}/comments`)
      .set(owner)
      .send({ body: 'bye' })
      .expect(201);
    const aunt = await http
      .post('/api/trips/join')
      .send({ code: inviteCode, name: 'Aunt' })
      .expect(201);
    await http
      .delete(`/api/trips/${tripId}/photos/${second}`)
      .set({ Authorization: `Bearer ${aunt.body.token}` })
      .expect(403);
    await http
      .delete(`/api/trips/${tripId}/photos/${second}`)
      .set(kid)
      .expect(204);
    expect(existsSync(join(photosDir(), tripId, `${second}.png`))).toBe(false);
    await http
      .get(`/api/trips/${tripId}/photos/${second}/comments`)
      .set(owner)
      .expect(404);
    await http.get(`/api/photo-files/${second}/original`).expect(404);
    const zip = await http
      .get(`/api/trips/${tripId}/photos.zip?token=${ownerToken}`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    const body = zip.body as Buffer;
    expect(
      body.readUInt16LE(
        body.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) + 10,
      ),
    ).toBe(1);
    await http
      .delete(`/api/trips/${tripId}/photos/${first}`)
      .set(owner)
      .expect(204);
    await http
      .get(`/api/trips/${tripId}/photos.zip?token=${ownerToken}`)
      .expect(404);
  });
});
