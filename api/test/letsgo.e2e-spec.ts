import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

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
