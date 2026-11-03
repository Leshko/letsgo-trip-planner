import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  LocationService,
  isLive,
  tripToday,
} from '../src/location/location.service';
import { freshDatabase } from './db';
import { organizer } from './accounts';

const iso = (offsetDays: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

describe('family map (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
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
  });

  afterAll(async () => {
    await app.close();
  });

  async function trip(start: number, end: number, name = 'Beach') {
    const t = await http
      .post('/api/trips')
      .set(await organizer(app))
      .send({
        name,
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
      id: t.body.trip.id as string,
      mom: t.body.token as string,
      dad: dad.body.token as string,
    };
  }

  it('knows when a trip is on, with a day of slack each side', () => {
    const now = new Date('2027-07-10T12:00:00Z');
    expect(
      isLive({ startDate: '2027-07-11', endDate: '2027-07-15' }, now),
    ).toBe(true);
    expect(
      isLive({ startDate: '2027-07-12', endDate: '2027-07-15' }, now),
    ).toBe(false);
    expect(
      isLive({ startDate: '2027-07-01', endDate: '2027-07-09' }, now),
    ).toBe(true);
    expect(
      isLive({ startDate: '2027-07-01', endDate: '2027-07-08' }, now),
    ).toBe(false);
  });

  it('ends at midnight after the last day in the trip time zone', () => {
    const trip = {
      startDate: '2027-07-12',
      endDate: '2027-07-15',
      timeZone: 'America/Los_Angeles',
    };
    // 11:30 pm on the last day in Los Angeles: still on.
    expect(tripToday(trip, new Date('2027-07-16T06:30:00Z'))).toBe(
      '2027-07-15',
    );
    expect(isLive(trip, new Date('2027-07-16T06:30:00Z'))).toBe(true);
    // 12:30 am the next morning: over, with no extra day of slack.
    expect(isLive(trip, new Date('2027-07-16T07:30:00Z'))).toBe(false);
    // Not on yet the evening before the first day.
    expect(isLive(trip, new Date('2027-07-12T06:30:00Z'))).toBe(false);
    expect(isLive(trip, new Date('2027-07-12T07:30:00Z'))).toBe(true);
    // Unknown or broken zone falls back to the slack rule.
    expect(tripToday({ timeZone: '' })).toBeNull();
    expect(tripToday({ timeZone: 'Mars/Olympus' })).toBeNull();
  });

  it('remembers the phone time zone and refuses bad ones', async () => {
    const t = await trip(-1, 2, 'Zone');
    await http
      .put(`/api/trips/${t.id}/me/location-sharing`)
      .set(auth(t.mom))
      .send({ on: true, timeZone: 'Mars/Olympus' })
      .expect(400);
    await http
      .put(`/api/trips/${t.id}/me/location-sharing`)
      .set(auth(t.mom))
      .send({ on: true, timeZone: 'UTC' })
      .expect(200);
    const row = await app
      .get(DataSource)
      .query(`SELECT "timeZone" FROM trip WHERE id = $1`, [t.id]);
    expect(row[0].timeZone).toBe('UTC');
    await http
      .put(`/api/trips/${t.id}/me/location`)
      .set(auth(t.mom))
      .send({ lat: 1, lng: 2, timeZone: 'America/Denver' })
      .expect(200);
    const row2 = await app
      .get(DataSource)
      .query(`SELECT "timeZone" FROM trip WHERE id = $1`, [t.id]);
    expect(row2[0].timeZone).toBe('America/Denver');
  });

  it('switches everyone off within minutes of midnight after the last day', async () => {
    // A trip whose last day is today in UTC; at 00:05 tomorrow UTC it is over.
    const t = await trip(-2, 0, 'Midnight');
    for (const tok of [t.mom, t.dad]) {
      await http
        .put(`/api/trips/${t.id}/me/location-sharing`)
        .set(auth(tok))
        .send({ on: true, timeZone: 'UTC' })
        .expect(200);
      await http
        .put(`/api/trips/${t.id}/me/location`)
        .set(auth(tok))
        .send({ lat: 3, lng: 4 })
        .expect(200);
    }
    const svc = app.get(LocationService);
    const ds = app.get(DataSource);
    const count = async () =>
      (
        await ds.query(
          `SELECT count(*)::int AS n FROM member_location ml JOIN member m ON m.id = ml."memberId" WHERE m."tripId" = $1`,
          [t.id],
        )
      )[0].n;

    // Late on the last day: nothing changes.
    const lastEvening = new Date(iso(0) + 'T23:55:00Z');
    await svc.sweep(lastEvening);
    expect(await count()).toBe(2);

    // Just after midnight: sharing is off for everyone and the spots are gone.
    const afterMidnight = new Date(iso(1) + 'T00:05:00Z');
    await svc.sweep(afterMidnight);
    expect(await count()).toBe(0);
    const sharers = await ds.query(
      `SELECT count(*)::int AS n FROM member WHERE "tripId" = $1 AND "sharesLocation" = true`,
      [t.id],
    );
    expect(sharers[0].n).toBe(0);
  });

  it('is off by default, and only sharers show on the map', async () => {
    const t = await trip(0, 3);
    const view = await http
      .get(`/api/trips/${t.id}`)
      .set(auth(t.mom))
      .expect(200);
    expect(
      view.body.members.every(
        (m: { sharesLocation: boolean }) => !m.sharesLocation,
      ),
    ).toBe(true);

    // Not sharing yet: a position is refused.
    await http
      .put(`/api/trips/${t.id}/me/location`)
      .set(auth(t.mom))
      .send({ lat: 41.1, lng: -70.1 })
      .expect(409);

    const me = await http
      .put(`/api/trips/${t.id}/me/location-sharing`)
      .set(auth(t.mom))
      .send({ on: true })
      .expect(200);
    expect(me.body.sharesLocation).toBe(true);
    await http
      .put(`/api/trips/${t.id}/me/location`)
      .set(auth(t.mom))
      .send({ lat: 41.123456789, lng: -70.987654321, accuracy: 12.4 })
      .expect(200);

    const map = await http
      .get(`/api/trips/${t.id}/locations`)
      .set(auth(t.dad))
      .expect(200);
    expect(map.body.live).toBe(true);
    expect(map.body.locations).toHaveLength(1);
    expect(map.body.locations[0]).toMatchObject({
      member: { name: 'Mom', sharesLocation: true },
      lat: 41.12346,
      lng: -70.98765,
      accuracy: 12,
    });
    const after = await http
      .get(`/api/trips/${t.id}`)
      .set(auth(t.dad))
      .expect(200);
    expect(
      after.body.members.find((m: { name: string }) => m.name === 'Mom')
        .sharesLocation,
    ).toBe(true);
  });

  it('rejects bad coordinates', async () => {
    const t = await trip(0, 1);
    await http
      .put(`/api/trips/${t.id}/me/location-sharing`)
      .set(auth(t.dad))
      .send({ on: true })
      .expect(200);
    for (const body of [
      { lat: 91, lng: 0 },
      { lat: 0, lng: 181 },
      { lat: 'x', lng: 0 },
      { lng: 0 },
    ]) {
      await http
        .put(`/api/trips/${t.id}/me/location`)
        .set(auth(t.dad))
        .send(body)
        .expect(400);
    }
    await http
      .put(`/api/trips/${t.id}/me/location-sharing`)
      .set(auth(t.dad))
      .send({ on: 'yes' })
      .expect(400);
  });

  it('keeps other trips out', async () => {
    const a = await trip(0, 2, 'A');
    const b = await trip(0, 2, 'B');
    await http
      .put(`/api/trips/${a.id}/me/location-sharing`)
      .set(auth(a.mom))
      .send({ on: true })
      .expect(200);
    await http
      .put(`/api/trips/${a.id}/me/location`)
      .set(auth(a.mom))
      .send({ lat: 1, lng: 2 })
      .expect(200);
    await http.get(`/api/trips/${a.id}/locations`).set(auth(b.mom)).expect(403);
    await http.get(`/api/trips/${a.id}/locations`).expect(401);
    const own = await http
      .get(`/api/trips/${b.id}/locations`)
      .set(auth(b.mom))
      .expect(200);
    expect(own.body.locations).toEqual([]);
  });

  it('switching off deletes the stored location', async () => {
    const t = await trip(-1, 1);
    await http
      .put(`/api/trips/${t.id}/me/location-sharing`)
      .set(auth(t.dad))
      .send({ on: true })
      .expect(200);
    await http
      .put(`/api/trips/${t.id}/me/location`)
      .set(auth(t.dad))
      .send({ lat: 10, lng: 20 })
      .expect(200);
    await http
      .put(`/api/trips/${t.id}/me/location-sharing`)
      .set(auth(t.dad))
      .send({ on: false })
      .expect(200);
    const map = await http
      .get(`/api/trips/${t.id}/locations`)
      .set(auth(t.mom))
      .expect(200);
    expect(
      map.body.locations.find(
        (l: { member: { name: string } }) => l.member.name === 'Dad',
      ),
    ).toBeUndefined();
    const dad = await app
      .get(DataSource)
      .query(
        `SELECT count(*)::int AS n FROM member_location ml JOIN member m ON m.id = ml."memberId" WHERE m."tripId" = $1`,
        [t.id],
      );
    expect(dad[0].n).toBe(0);
  });

  it('cannot start before the trip, and closes once it is over', async () => {
    const future = await trip(10, 14, 'Later');
    await http
      .put(`/api/trips/${future.id}/me/location-sharing`)
      .set(auth(future.mom))
      .send({ on: true })
      .expect(409);
    const map = await http
      .get(`/api/trips/${future.id}/locations`)
      .set(auth(future.mom))
      .expect(200);
    expect(map.body).toEqual({ live: false, locations: [] });

    // A trip that is on, then its dates move into the past.
    const t = await trip(0, 2, 'Done');
    await http
      .put(`/api/trips/${t.id}/me/location-sharing`)
      .set(auth(t.mom))
      .send({ on: true })
      .expect(200);
    await http
      .put(`/api/trips/${t.id}/me/location`)
      .set(auth(t.mom))
      .send({ lat: 5, lng: 6 })
      .expect(200);
    const ds = app.get(DataSource);
    await ds.query(
      `UPDATE trip SET "startDate" = $1, "endDate" = $2 WHERE id = $3`,
      [iso(-10), iso(-5), t.id],
    );

    expect(await app.get(LocationService).sweep()).toBeGreaterThanOrEqual(1);
    const left = await ds.query(
      `SELECT count(*)::int AS n FROM member_location ml JOIN member m ON m.id = ml."memberId" WHERE m."tripId" = $1`,
      [t.id],
    );
    expect(left[0].n).toBe(0);
    const view = await http
      .get(`/api/trips/${t.id}`)
      .set(auth(t.mom))
      .expect(200);
    expect(
      view.body.members.some(
        (m: { sharesLocation: boolean }) => m.sharesLocation,
      ),
    ).toBe(false);
    await http
      .put(`/api/trips/${t.id}/me/location`)
      .set(auth(t.mom))
      .send({ lat: 5, lng: 6 })
      .expect(409);
  });

  it('hides positions older than six hours', async () => {
    const t = await trip(0, 2, 'Stale');
    await http
      .put(`/api/trips/${t.id}/me/location-sharing`)
      .set(auth(t.mom))
      .send({ on: true })
      .expect(200);
    await http
      .put(`/api/trips/${t.id}/me/location`)
      .set(auth(t.mom))
      .send({ lat: 5, lng: 6 })
      .expect(200);
    await app
      .get(DataSource)
      .query(
        `UPDATE member_location SET "updatedAt" = $1 WHERE "memberId" IN (SELECT id FROM member WHERE "tripId" = $2)`,
        [Date.now() - 7 * 60 * 60 * 1000, t.id],
      );
    const map = await http
      .get(`/api/trips/${t.id}/locations`)
      .set(auth(t.dad))
      .expect(200);
    expect(map.body.locations).toEqual([]);
  });
});
