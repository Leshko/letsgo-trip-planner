import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { isLive } from '../src/location/location.service';
import { freshDatabase } from './db';
import { organizer } from './accounts';

const KEY = 'test-admin-key-0123456789abcdef';
const iso = (offsetDays: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

describe('gatherings (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    process.env.ADMIN_KEY = KEY;
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

  async function create(kind: string | undefined, start = 0, end = 0) {
    const account = await organizer(app);
    const t = await http
      .post('/api/trips')
      .set(account)
      .send({
        ...(kind ? { kind } : {}),
        name: kind === 'gathering' ? 'Thanksgiving' : 'Lake Week',
        destination: "Grandma's house",
        startDate: iso(start),
        endDate: iso(end),
        memberName: 'Mom',
      })
      .expect(201);
    const dad = await http
      .post('/api/trips/join')
      .send({ code: t.body.trip.inviteCode, name: 'Dad' })
      .expect(201);
    return {
      account,
      id: t.body.trip.id as string,
      kind: t.body.trip.kind as string,
      mom: t.body.token as string,
      dad: dad.body.token as string,
      dadTripKind: dad.body.trip.kind as string,
    };
  }

  it('a trip is the default; a gathering is asked for', async () => {
    const trip = await create(undefined);
    expect(trip.kind).toBe('trip');
    const g = await create('gathering');
    expect(g.kind).toBe('gathering');
    expect(g.dadTripKind).toBe('gathering');
    const view = await http
      .get(`/api/trips/${g.id}`)
      .set(auth(g.dad))
      .expect(200);
    expect(view.body.kind).toBe('gathering');
    await http
      .post('/api/trips')
      .set(await organizer(app))
      .send({
        kind: 'party',
        name: 'X',
        startDate: iso(0),
        endDate: iso(0),
        memberName: 'M',
      })
      .expect(400);
  });

  it('trips that existed before gatherings stay trips', async () => {
    const t = await create(undefined);
    // What the migration does for old rows: the column default.
    const row = await app
      .get(DataSource)
      .query(
        `SELECT kind, column_default FROM trip, information_schema.columns WHERE trip.id = $1 AND table_name = 'trip' AND column_name = 'kind'`,
        [t.id],
      );
    expect(row[0].kind).toBe('trip');
    expect(row[0].column_default).toContain("'trip'");
  });

  it('never shares locations for a gathering, even on the day', async () => {
    expect(
      isLive({ kind: 'gathering', startDate: iso(0), endDate: iso(0) }),
    ).toBe(false);
    expect(isLive({ kind: 'trip', startDate: iso(0), endDate: iso(0) })).toBe(
      true,
    );
    const g = await create('gathering', 0, 0);
    const on = await http
      .put(`/api/trips/${g.id}/me/location-sharing`)
      .set(auth(g.mom))
      .send({ on: true, timeZone: 'UTC' })
      .expect(409);
    expect(on.body.message).toMatch(/Gatherings don't have a family map/);
    await http
      .put(`/api/trips/${g.id}/me/location`)
      .set(auth(g.mom))
      .send({ lat: 1, lng: 2 })
      .expect(409);
    const map = await http
      .get(`/api/trips/${g.id}/locations`)
      .set(auth(g.dad))
      .expect(200);
    expect(map.body).toEqual({ live: false, locations: [] });
    const rows = await app
      .get(DataSource)
      .query(
        `SELECT count(*)::int AS n FROM member WHERE "tripId" = $1 AND "sharesLocation"`,
        [g.id],
      );
    expect(rows[0].n).toBe(0);
    // Switching it off is always allowed.
    await http
      .put(`/api/trips/${g.id}/me/location-sharing`)
      .set(auth(g.mom))
      .send({ on: false })
      .expect(200);
  });

  it('has no ideas or plan', async () => {
    const g = await create('gathering', 5, 5);
    const idea = await http
      .post(`/api/trips/${g.id}/ideas`)
      .set(auth(g.mom))
      .send({ kind: 'activity', title: 'Kayak' })
      .expect(409);
    expect(idea.body.message).toMatch(/Gatherings don't have ideas/);
    await http
      .post(`/api/trips/${g.id}/itinerary`)
      .set(auth(g.mom))
      .send({ date: iso(5), title: 'Dinner' })
      .expect(409);
    // Reading is harmless and empty.
    expect(
      (await http.get(`/api/trips/${g.id}/ideas`).set(auth(g.mom)).expect(200))
        .body,
    ).toEqual([]);
    // A trip is unaffected.
    const t = await create('trip', 5, 6);
    await http
      .post(`/api/trips/${t.id}/ideas`)
      .set(auth(t.mom))
      .send({ kind: 'activity', title: 'Kayak' })
      .expect(201);
    await http
      .post(`/api/trips/${t.id}/itinerary`)
      .set(auth(t.mom))
      .send({ date: iso(5), title: 'Dinner' })
      .expect(201);
  });

  it('keeps the wall, polls, photos list and where & when', async () => {
    const g = await create('gathering', 5, 5);
    await http
      .post(`/api/trips/${g.id}/posts`)
      .set(auth(g.dad))
      .send({ body: 'I will bring the pie' })
      .expect(201);
    const poll = await http
      .post(`/api/trips/${g.id}/posts`)
      .set(auth(g.mom))
      .send({ body: 'Turkey or ham?', poll: { options: ['Turkey', 'Ham'] } })
      .expect(201);
    await http
      .post(`/api/trips/${g.id}/posts/${poll.body.id}/vote`)
      .set(auth(g.dad))
      .send({ optionId: poll.body.poll.options[0].id })
      .expect(200);
    await http.get(`/api/trips/${g.id}/photos`).set(auth(g.dad)).expect(200);
    const where = await http
      .put(`/api/trips/${g.id}/lodging`)
      .set(auth(g.mom))
      .send({
        name: "Grandma's house",
        address: '12 Maple St, Springfield',
        checkIn: '2:00 pm',
        notes: 'Bring a side dish',
      })
      .expect(200);
    expect(where.body.lodging).toMatchObject({
      name: "Grandma's house",
      checkIn: '2:00 pm',
      notes: 'Bring a side dish',
    });
    expect(where.body.kind).toBe('gathering');
    const after = await http
      .get(`/api/trips/${g.id}/activity`)
      .set(auth(g.mom))
      .expect(200);
    expect(after.body.map((a: { message: string }) => a.message)).toContain(
      "updated where & when: Grandma's house",
    );
    const feed = await http
      .get(`/api/trips/${g.id}/activity`)
      .set(auth(g.mom))
      .expect(200);
    expect(feed.body.map((a: { message: string }) => a.message)).toContain(
      'set up Thanksgiving',
    );
  });

  it('shows the kind in My trips and on the admin screen', async () => {
    const g = await create('gathering', 5, 5);
    const mine = await http.get('/api/account').set(g.account).expect(200);
    expect(
      mine.body.trips.map((t: { trip: { kind: string } }) => t.trip.kind),
    ).toEqual(['gathering']);
    const list = await http
      .get('/api/admin/trips')
      .set({ 'X-Admin-Key': KEY })
      .expect(200);
    const row = list.body.find((t: { id: string }) => t.id === g.id);
    expect(row.kind).toBe('gathering');
    expect(list.body.some((t: { kind: string }) => t.kind === 'trip')).toBe(
      true,
    );
  });
});
