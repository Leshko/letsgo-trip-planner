import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'crypto';
import { cpSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { LegacyImportService } from '../src/database/legacy-import.service';
import { freshDatabase } from './db';

/** A real database written by the last SQLite version, through its own API. */
const FIXTURE = join(__dirname, 'fixtures', 'legacy-v1');
const ids = JSON.parse(readFileSync(join(FIXTURE, 'ids.json'), 'utf8')) as {
  tripId: string;
  secondTripId: string;
  inviteCode: string;
  momToken: string;
  dadToken: string;
  kidToken: string;
  kayakId: string;
  tacosId: string;
  photoId: string;
};
const sha = (p: string) =>
  createHash('sha256').update(readFileSync(p)).digest('hex');

/** Copy the fixture into a fresh data folder, optionally tampering with the copy. */
function stageDataDir(tamper?: (db: Database.Database) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'letsgo-legacy-'));
  cpSync(FIXTURE, dir, { recursive: true });
  if (tamper) {
    const db = new Database(join(dir, 'letsgo.sqlite'));
    db.pragma('foreign_keys = OFF');
    tamper(db);
    db.close();
  }
  process.env.DATA_DIR = dir;
  return dir;
}

async function boot(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

describe('moving from SQLite to Postgres (e2e)', () => {
  let app: INestApplication;
  let dir: string;
  let sqliteHash: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    await freshDatabase();
    dir = stageDataDir((db) => {
      // An admin-merged device from the live version: its token opens Mom's spot.
      db.exec(
        `CREATE TABLE IF NOT EXISTS "member_alias" ("createdAt" integer NOT NULL, "token" varchar PRIMARY KEY NOT NULL, "memberId" varchar NOT NULL)`,
      );
      db.prepare(
        `INSERT INTO member_alias (createdAt, token, memberId) VALUES (1, 'merged-device-token-0001', (SELECT id FROM member WHERE token = ?))`,
      ).run(ids.momToken);
      // A comment whose idea was deleted long ago: it can't be shown anywhere.
      db.prepare(
        `INSERT INTO comment (id, tripId, ideaId, memberId, body, createdAt) VALUES (?, ?, ?, (SELECT id FROM member LIMIT 1), 'ghost', 1)`,
      ).run(randomUUID(), ids.tripId, randomUUID());
    });
    sqliteHash = sha(join(dir, 'letsgo.sqlite'));
    app = await boot();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DATA_DIR;
  });

  const http = () => request(app.getHttpServer());

  it('keeps everyone signed in to the same trip and member', async () => {
    const me = await http()
      .get('/api/trips/me')
      .set(auth(ids.momToken))
      .expect(200);
    expect(me.body.trip.id).toBe(ids.tripId);
    expect(me.body.trip.name).toBe('Lake Tahoe 2027');
    expect(me.body.trip.inviteCode).toBe(ids.inviteCode);
    expect(me.body.member.name).toBe('Mom');
    expect(me.body.member.isOwner).toBe(true);
    expect(me.body.member.emoji).toBe('🌻');
    expect(me.body.trip.lodging.notes).toBe('Code 4321');
    expect(
      me.body.trip.members.map((m: { name: string }) => m.name).sort(),
    ).toEqual(['Dad', 'Mom', 'Sam']);

    const kid = await http()
      .get('/api/trips/me')
      .set(auth(ids.kidToken))
      .expect(200);
    expect(kid.body.notifyPrefs.comments).toBe(false);
    expect(kid.body.member.emoji).toBe('🦖');
  });

  it('keeps devices an admin merged on the old version', async () => {
    const r = await http()
      .get('/api/trips/me')
      .set(auth('merged-device-token-0001'))
      .expect(200);
    expect(r.body.member.name).toBe('Mom');
  });

  it('keeps profile photos (stored as bytes)', async () => {
    const me = await http()
      .get('/api/trips/me')
      .set(auth(ids.momToken))
      .expect(200);
    const res = await http()
      .get(`/api/avatars/${me.body.member.id}`)
      .expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body.length).toBeGreaterThan(50);
  });

  it('keeps ideas, votes, comments, posts, reactions and the plan', async () => {
    const ideas = await http()
      .get(`/api/trips/${ids.tripId}/ideas`)
      .set(auth(ids.dadToken))
      .expect(200);
    const kayak = ideas.body.find((i: { id: string }) => i.id === ids.kayakId);
    const tacos = ideas.body.find((i: { id: string }) => i.id === ids.tacosId);
    expect(kayak.voteCount).toBe(3);
    expect(kayak.cost).toBe('$$');
    expect(kayak.details).toEqual([{ label: 'Hours', value: '9-5' }]);
    expect(tacos.menuUrl).toBe('https://tacos.example/menu.pdf');
    expect(tacos.commentCount).toBe(1);
    expect(typeof kayak.createdAt).toBe('string');
    expect(Number.isNaN(Date.parse(kayak.createdAt))).toBe(false);

    const comments = await http()
      .get(`/api/trips/${ids.tripId}/ideas/${ids.tacosId}/comments`)
      .set(auth(ids.momToken))
      .expect(200);
    expect(comments.body.map((c: { body: string }) => c.body)).toEqual([
      'Churros!!',
    ]);

    const posts = await http()
      .get(`/api/trips/${ids.tripId}/posts`)
      .set(auth(ids.momToken))
      .expect(200);
    expect(posts.body[0].body).toBe('Who is bringing the board games?');
    expect(JSON.stringify(posts.body[0].reactions)).toContain('🎲');

    const plan = await http()
      .get(`/api/trips/${ids.tripId}/itinerary`)
      .set(auth(ids.momToken))
      .expect(200);
    const entries = (
      plan.body as {
        entries: { idea: { id: string } | null; title: string }[];
      }[]
    ).flatMap((d) => d.entries);
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.idea?.id === ids.kayakId)).toBeTruthy();
    expect(entries.find((e) => e.title === 'Lazy beach day')?.idea).toBeNull();
  });

  it('keeps photos, their files and comments', async () => {
    const photos = await http()
      .get(`/api/trips/${ids.tripId}/photos`)
      .set(auth(ids.momToken))
      .expect(200);
    expect(photos.body).toHaveLength(1);
    expect(photos.body[0].caption).toBe('First sunset');
    await http().get(`/api/photo-files/${ids.photoId}/original`).expect(200);
    const comments = await http()
      .get(`/api/trips/${ids.tripId}/photos/${ids.photoId}/comments`)
      .set(auth(ids.momToken))
      .expect(200);
    expect(comments.body[0].body).toBe('Gorgeous');
  });

  it('keeps notifications and push subscriptions', async () => {
    const n = await http()
      .get(`/api/trips/${ids.tripId}/notifications`)
      .set(auth(ids.momToken))
      .expect(200);
    expect(n.body.items.length).toBeGreaterThan(0);
    const ds = app.get(DataSource);
    const [{ count }] = await ds.query(
      `SELECT count(*)::int AS count FROM push_subscription WHERE endpoint = 'https://push.example/mom-phone'`,
    );
    expect(count).toBe(1);
  });

  it('records what was copied, skips unreachable rows, and leaves the old file untouched', async () => {
    const ds = app.get(DataSource);
    const [marker] = await ds.query(
      `SELECT counts FROM legacy_import WHERE id = 'sqlite'`,
    );
    const counts = JSON.parse(marker.counts);
    expect(counts).toMatchObject({
      trip: 2,
      member: 4,
      idea: 2,
      vote: 4,
      comment: 1,
      photo: 1,
      photo_comment: 1,
      post: 1,
      itinerary_entry: 2,
      push_subscription: 1,
    });
    expect(sha(join(dir, 'letsgo.sqlite'))).toBe(sqliteHash);
  });

  it('works normally afterwards and never imports twice', async () => {
    await http()
      .post(`/api/trips/${ids.tripId}/ideas/${ids.tacosId}/vote`)
      .set(auth(ids.momToken))
      .expect(201);
    await app.close();
    app = await boot();
    expect(await app.get(LegacyImportService).run()).toEqual({
      status: 'already-imported',
    });
    const ideas = await http()
      .get(`/api/trips/${ids.tripId}/ideas`)
      .set(auth(ids.dadToken))
      .expect(200);
    expect(
      ideas.body.find((i: { id: string }) => i.id === ids.tacosId).voteCount,
    ).toBe(2);
    const second = await http()
      .get('/api/trips/me')
      .set(auth(ids.dadToken))
      .expect(200);
    expect(second.body.trip.id).toBe(ids.tripId);
  });

  it('malformed ids are "not found", not a server error', async () => {
    await http()
      .get(`/api/trips/${ids.tripId}/ideas/not-a-uuid/comments`)
      .set(auth(ids.momToken))
      .expect(404);
  });
});

describe('a failed move changes nothing (e2e)', () => {
  afterAll(() => {
    delete process.env.DATA_DIR;
  });

  it('rolls back everything and refuses to start', async () => {
    const url = await freshDatabase();
    const dir = stageDataDir((db) => {
      // Something Postgres will reject partway through: a second trip with the same invite code.
      const cols = (
        db.prepare(`PRAGMA table_info(trip)`).all() as { name: string }[]
      ).map((c) => c.name);
      const list = cols.map((c) => `"${c}"`).join(',');
      const sel = cols
        .map((c) => (c === 'id' ? `'${randomUUID()}'` : `"${c}"`))
        .join(',');
      try {
        db.exec(
          `INSERT INTO trip (${list}) SELECT ${sel} FROM trip WHERE id = '${ids.tripId}'`,
        );
      } catch {
        // The unique constraint may live in the table definition; rebuild without it.
        const ddl = (
          db
            .prepare(`SELECT sql FROM sqlite_master WHERE name = 'trip'`)
            .get() as { sql: string }
        ).sql;
        db.exec(`ALTER TABLE trip RENAME TO trip_old`);
        db.exec(
          ddl
            .replace(/,\s*CONSTRAINT "[^"]+" UNIQUE \("inviteCode"\)/, '')
            .replace(
              /"inviteCode" varchar NOT NULL UNIQUE/,
              '"inviteCode" varchar NOT NULL',
            ),
        );
        db.exec(`INSERT INTO trip SELECT * FROM trip_old`);
        db.exec(`DROP TABLE trip_old`);
        db.exec(
          `INSERT INTO trip (${list}) SELECT ${sel} FROM trip WHERE id = '${ids.tripId}'`,
        );
      }
    });
    const before = sha(join(dir, 'letsgo.sqlite'));
    await expect(boot()).rejects.toThrow(/duplicate key|inviteCode|unique/i);
    expect(sha(join(dir, 'letsgo.sqlite'))).toBe(before);

    // Postgres is left empty: no half-copied trips, no "done" marker.
    const ds = new DataSource({ type: 'postgres', url });
    await ds.initialize();
    const [{ trips }] = await ds.query(
      `SELECT count(*)::int AS trips FROM trip`,
    );
    const [{ marks }] = await ds.query(
      `SELECT count(*)::int AS marks FROM legacy_import`,
    );
    await ds.destroy();
    expect(trips).toBe(0);
    expect(marks).toBe(0);
  });
});
