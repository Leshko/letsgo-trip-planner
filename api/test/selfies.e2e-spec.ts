import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AI_CLIENT, FakeAiClient } from '../src/ai/ai.client';
import type { StructuredInput } from '../src/ai/ai.client';
import { BUILT_IN } from '../src/selfies/selfie.ai';
import { NotificationsService } from '../src/notifications/notifications.service';
import { freshDatabase } from './db';
import { organizer } from './accounts';

interface Entry {
  id: string;
  status: string;
  judgedBy: string;
  comment: string;
  points: number;
  bonus: number;
  member: { name: string };
  photo: { id: string; thumb: string };
}
interface Challenge {
  id: string;
  title: string;
  hint: string;
  difficulty: string;
  points: number;
  source: string;
  done: Entry[];
  mine: Entry | null;
  myRejected: Entry | null;
  rejected: Entry[];
}
interface Game {
  status: string;
  canManage: boolean;
  challenges: Challenge[];
  scoreboard: {
    member: { name: string };
    points: number;
    done: number;
    rank: number;
  }[];
  me: { points: number; done: number; rank: number | null };
  total: number;
  winner: { member: { name: string }; points: number } | null;
}

const iso = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// A small real PNG (the server sniffs the bytes).
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('selfie game (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let ds: DataSource;
  let notif: NotificationsService;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  // The real fake client, wrapped so tests can count calls and see what the AI was sent.
  const fake = new FakeAiClient();
  const calls: StructuredInput<unknown>[] = [];
  const client = {
    summarize: fake.summarize.bind(fake),
    structured: <T>(input: StructuredInput<T>) => {
      calls.push(input);
      return fake.structured(input);
    },
  };

  beforeAll(async () => {
    process.env.AI_FAKE = '1';
    await freshDatabase();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_CLIENT)
      .useValue(client)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    ds = app.get(DataSource);
    notif = app.get(NotificationsService);
  });

  afterAll(async () => {
    delete process.env.AI_FAKE;
    await app.close();
  });

  beforeEach(() => {
    process.env.AI_FAKE = '1';
    calls.length = 0;
  });

  async function trip(
    start = -1,
    end = 2,
    extra: Record<string, unknown> = {},
  ) {
    const t = await http
      .post('/api/trips')
      .set(await organizer(app))
      .send({
        name: 'Lake Week',
        destination: 'Lake Tahoe',
        startDate: iso(start),
        endDate: iso(end),
        memberName: 'Mom',
        ...extra,
      })
      .expect(201);
    const join = async (name: string) =>
      (
        await http
          .post('/api/trips/join')
          .send({ code: t.body.trip.inviteCode, name })
          .expect(201)
      ).body.token as string;
    return {
      id: t.body.trip.id as string,
      mom: t.body.token as string,
      dad: await join('Dad'),
      kid: await join('Kid'),
    };
  }
  const game = async (t: { id: string }, token: string) =>
    (await http.get(`/api/trips/${t.id}/selfies`).set(auth(token)).expect(200))
      .body as Game;
  const selfie = (t: { id: string }, token: string, challengeId: string) =>
    http
      .post(`/api/trips/${t.id}/selfies/challenges/${challengeId}/entries`)
      .set(auth(token))
      .field('batchId', 'selfie-batch-1')
      .attach('original', png, {
        filename: 'me.png',
        contentType: 'image/png',
      });

  it('writes the list once, from the trip, even when everyone opens it at the same moment', async () => {
    const t = await trip();
    await http
      .post(`/api/trips/${t.id}/itinerary`)
      .set(auth(t.mom))
      .send({ date: iso(0), title: 'Kayak at Sand Harbor' })
      .expect(201);
    const views = await Promise.all([
      game(t, t.mom),
      game(t, t.dad),
      game(t, t.kid),
    ]);
    expect(
      views.every((v) => v.status === 'open' || v.status === 'preparing'),
    ).toBe(true);
    const g = await game(t, t.dad);
    expect(g.status).toBe('open');
    expect(g.total).toBe(10);
    expect(g.challenges.map((c) => c.points).sort((a, b) => a - b)).toEqual([
      10, 10, 10, 10, 20, 20, 20, 20, 30, 30,
    ]);
    expect(g.challenges.every((c) => c.source === 'ai')).toBe(true);
    expect(g.challenges[0].difficulty).toBe('easy');
    expect(g.canManage).toBe(false);
    expect((await game(t, t.mom)).canManage).toBe(true);
    // One list, one AI call, however many phones asked.
    const lists = calls.filter((c) => c.task === 'selfie-list');
    expect(lists).toHaveLength(1);
    const rows = await ds.query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM selfie_challenge WHERE "tripId" = $1`,
      [t.id],
    );
    expect(rows[0].n).toBe(10);
    // The AI was told about the trip and its plan, and nobody's name.
    expect(lists[0].user).toContain('Destination: Lake Tahoe');
    expect(lists[0].user).toContain('Kayak at Sand Harbor');
    expect(lists[0].user).not.toMatch(/Mom|Dad|Kid/);
    expect(
      g.challenges.some((c) => c.title === 'Selfie at Kayak at Sand Harbor'),
    ).toBe(true);
  });

  it('uses the built-in list when the AI is off', async () => {
    delete process.env.AI_FAKE;
    const t = await trip();
    const g = await game(t, t.mom);
    expect(g.total).toBe(10);
    expect(g.challenges.every((c) => c.source === 'builtin')).toBe(true);
    expect(calls).toHaveLength(0);
    const builtIn = new Set(BUILT_IN.map((b) => b.title));
    expect(g.challenges.every((c) => builtIn.has(c.title))).toBe(true);
    // And with no AI to judge, a selfie counts on the honor system.
    const r = await selfie(t, t.dad, g.challenges[0].id).expect(201);
    expect(r.body.entry).toMatchObject({
      status: 'approved',
      judgedBy: 'honor',
      points: 10,
      bonus: 5,
    });
  });

  it('scores a selfie, gives the first finisher a bonus, and puts it in the album', async () => {
    const t = await trip();
    const g = await game(t, t.mom);
    const easy = g.challenges[0];
    const hard = g.challenges[9];

    const first = await selfie(t, t.dad, easy.id).expect(201);
    expect(first.body.entry).toMatchObject({
      status: 'approved',
      judgedBy: 'ai',
      points: 10,
      bonus: 5,
      comment: 'Nailed it. Great energy!',
    });
    expect(first.body.game.me).toEqual({ points: 15, done: 1, rank: 1 });
    // The judge saw the photo and the challenge.
    const judged = calls.find((c) => c.task === 'selfie-judge')!;
    expect(judged.image?.mediaType).toBe('image/png');
    expect(judged.image!.base64.length).toBeGreaterThan(50);
    expect(judged.user).toContain(easy.title);

    const second = await selfie(t, t.kid, easy.id).expect(201);
    expect(second.body.entry).toMatchObject({
      status: 'approved',
      points: 10,
      bonus: 0,
    });
    await selfie(t, t.kid, hard.id).expect(201);

    const board = await game(t, t.mom);
    expect(
      board.scoreboard.map(
        (r) => `${r.rank}. ${r.member.name} ${r.points} (${r.done})`,
      ),
    ).toEqual(['1. Kid 45 (2)', '2. Dad 15 (1)']);
    expect(board.me).toEqual({ points: 0, done: 0, rank: null });
    expect(board.challenges[0].done.map((e) => e.member.name)).toEqual([
      'Dad',
      'Kid',
    ]);
    expect(board.winner).toBeNull();

    // It's an ordinary album photo, labeled with the challenge.
    const album = await http
      .get(`/api/trips/${t.id}/photos`)
      .set(auth(t.mom))
      .expect(200);
    expect(album.body).toHaveLength(3);
    expect(album.body.map((p: { caption: string }) => p.caption)).toContain(
      `🤳 ${easy.title}`,
    );
    await http.get(first.body.entry.photo.thumb).expect(200);

    // The feed says what happened; the notification opens the game.
    await notif.whenIdle();
    const feed = await http
      .get(`/api/trips/${t.id}/activity`)
      .set(auth(t.mom))
      .expect(200);
    expect(feed.body.map((a: { message: string }) => a.message)).toContain(
      `completed "${easy.title}" (+15)`,
    );
    const bell = await http
      .get(`/api/trips/${t.id}/notifications`)
      .set(auth(t.mom))
      .expect(200);
    expect(
      bell.body.items.some((n: { url: string }) => n.url === '/trip/selfies'),
    ).toBe(true);

    // Level on points: whoever got there first ranks higher.
    await selfie(t, t.mom, hard.id).expect(201); // 30, no bonus (Kid was first)
    await selfie(t, t.dad, g.challenges[4].id).expect(201); // +20 +5 → 40
    await selfie(t, t.mom, easy.id).expect(201); // +10 → 40, after Dad
    expect(
      (await game(t, t.mom)).scoreboard.map(
        (r) => `${r.member.name} ${r.points}`,
      ),
    ).toEqual(['Kid 45', 'Dad 40', 'Mom 40']);
  });

  it("a selfie that doesn't match scores nothing; a retake can", async () => {
    const t = await trip();
    await game(t, t.mom);
    const withIt = await http
      .post(`/api/trips/${t.id}/selfies/challenges`)
      .set(auth(t.mom))
      .send({ title: 'Impossible selfie with a unicorn', difficulty: 'hard' })
      .expect(201);
    const unicorn = (withIt.body as Game).challenges.find((c) =>
      c.title.startsWith('Impossible'),
    )!;
    expect(unicorn).toMatchObject({ source: 'custom', points: 30 });

    const no = await selfie(t, t.dad, unicorn.id).expect(201);
    expect(no.body.entry).toMatchObject({
      status: 'rejected',
      judgedBy: 'ai',
      points: 0,
      bonus: 0,
    });
    expect(no.body.entry.comment).toMatch(/can't spot it/);
    expect(no.body.earlierStillCounts).toBe(false);
    expect(no.body.game.me.points).toBe(0);
    let mine = (await game(t, t.dad)).challenges.find(
      (c) => c.id === unicorn.id,
    )!;
    expect(mine.mine).toBeNull();
    expect(mine.myRejected?.status).toBe('rejected');
    // Only the organizer sees other people's turned-down selfies.
    expect(mine.rejected).toEqual([]);
    expect(
      (await game(t, t.mom)).challenges.find((c) => c.id === unicorn.id)!
        .rejected,
    ).toHaveLength(1);

    // The organizer rewords it; now a retake counts and the old refusal is gone.
    await http
      .patch(`/api/trips/${t.id}/selfies/challenges/${unicorn.id}`)
      .set(auth(t.mom))
      .send({ title: 'Selfie with a horse' })
      .expect(200);
    const yes = await selfie(t, t.dad, unicorn.id).expect(201);
    expect(yes.body.entry).toMatchObject({
      status: 'approved',
      points: 30,
      bonus: 5,
    });
    mine = (await game(t, t.dad)).challenges.find((c) => c.id === unicorn.id)!;
    expect(mine.mine?.points).toBe(30);
    expect(mine.myRejected).toBeNull();
  });

  it('a later retake never loses points already earned', async () => {
    const t = await trip();
    const g = await game(t, t.mom);
    const c = g.challenges[0];
    await selfie(t, t.dad, c.id).expect(201); // 10 + 5
    // Retake that counts: replaces the photo, keeps the first-finisher bonus.
    const again = await selfie(t, t.dad, c.id).expect(201);
    expect(again.body.entry).toMatchObject({
      status: 'approved',
      points: 10,
      bonus: 5,
    });
    expect((await game(t, t.dad)).me).toEqual({ points: 15, done: 1, rank: 1 });
    // The challenge is reworded to something the judge refuses: the earlier selfie still counts.
    await http
      .patch(`/api/trips/${t.id}/selfies/challenges/${c.id}`)
      .set(auth(t.mom))
      .send({ title: 'Impossible selfie' })
      .expect(200);
    const no = await selfie(t, t.dad, c.id).expect(201);
    expect(no.body.entry.status).toBe('rejected');
    expect(no.body.earlierStillCounts).toBe(true);
    expect(no.body.game.me.points).toBe(15);
  });

  it('counts the selfie on the honor system when the AI fails', async () => {
    const t = await trip();
    await game(t, t.mom);
    const g = (
      await http
        .post(`/api/trips/${t.id}/selfies/challenges`)
        .set(auth(t.mom))
        .send({ title: 'Selfie with a slow snail', difficulty: 'medium' })
        .expect(201)
    ).body as Game;
    const snail = g.challenges.find((c) => c.title.includes('snail'))!;
    const r = await selfie(t, t.kid, snail.id).expect(201);
    expect(r.body.entry).toMatchObject({
      status: 'approved',
      judgedBy: 'honor',
      points: 20,
      bonus: 5,
      comment: '',
    });
  });

  it('lets the organizer overrule the judge, both ways', async () => {
    const t = await trip();
    await game(t, t.mom);
    const g = (
      await http
        .post(`/api/trips/${t.id}/selfies/challenges`)
        .set(auth(t.mom))
        .send({ title: 'Impossible selfie on the moon', difficulty: 'easy' })
        .expect(201)
    ).body as Game;
    const moon = g.challenges.find((c) => c.title.includes('moon'))!;
    const no = await selfie(t, t.dad, moon.id).expect(201);
    const entryId = no.body.entry.id as string;
    const put = (token: string, id: string, status: string) =>
      http
        .put(`/api/trips/${t.id}/selfies/entries/${id}`)
        .set(auth(token))
        .send({ status });
    await put(t.dad, entryId, 'approved').expect(403);
    await put(t.mom, entryId, 'maybe').expect(400);
    const counted = (await put(t.mom, entryId, 'approved').expect(200))
      .body as Game;
    const now = counted.challenges.find((c) => c.id === moon.id)!;
    expect(now.done[0]).toMatchObject({
      status: 'approved',
      judgedBy: 'organizer',
      points: 10,
      bonus: 5,
    });
    expect(now.rejected).toEqual([]);
    expect(counted.scoreboard[0]).toMatchObject({ points: 15, rank: 1 });
    // And take one off the board.
    const removed = (await put(t.mom, entryId, 'rejected').expect(200))
      .body as Game;
    expect(removed.scoreboard).toEqual([]);
    expect(
      removed.challenges.find((c) => c.id === moon.id)!.rejected[0],
    ).toMatchObject({ judgedBy: 'organizer', points: 0 });
  });

  it('replaces one challenge with a new idea of the same difficulty', async () => {
    const t = await trip();
    const g = await game(t, t.mom);
    const target = g.challenges[5];
    expect(target.difficulty).toBe('medium');
    await http
      .post(`/api/trips/${t.id}/selfies/challenges/${target.id}/replace`)
      .set(auth(t.dad))
      .expect(403);

    // Someone already scored it: they keep the points.
    await selfie(t, t.kid, target.id).expect(201);
    calls.length = 0;
    const after = (
      await http
        .post(`/api/trips/${t.id}/selfies/challenges/${target.id}/replace`)
        .set(auth(t.mom))
        .expect(200)
    ).body as Game;
    expect(after.total).toBe(10);
    const fresh = after.challenges[5];
    expect(fresh.id).not.toBe(target.id);
    expect(fresh).toMatchObject({
      title: 'Selfie with a rainbow of colors',
      difficulty: 'medium',
      points: 20,
      source: 'ai',
      done: [],
    });
    expect(after.challenges.map((c) => c.title)).not.toContain(target.title);
    expect(after.scoreboard[0]).toMatchObject({ points: 25, done: 1 });
    // The AI was told what was removed and what's still there.
    const ask = calls.find((c) => c.task === 'selfie-replace')!;
    expect(ask.user).toContain(
      `<removed_challenge>${target.title}</removed_challenge>`,
    );
    expect(ask.user).toContain(g.challenges[0].title);
    expect(ask.user).toContain('Difficulty wanted: medium');
    // The old one can't be played any more.
    await selfie(t, t.dad, target.id).expect(404);

    // Replace the replacement: a different idea again, never a repeat.
    const again = (
      await http
        .post(`/api/trips/${t.id}/selfies/challenges/${fresh.id}/replace`)
        .set(auth(t.mom))
        .expect(200)
    ).body as Game;
    expect(again.challenges[5].title).toBe(
      'Selfie with a street musician sign',
    );
    expect(new Set(again.challenges.map((c) => c.title)).size).toBe(10);

    // With the AI off, the replacement comes from the built-in list.
    delete process.env.AI_FAKE;
    const off = (
      await http
        .post(
          `/api/trips/${t.id}/selfies/challenges/${again.challenges[0].id}/replace`,
        )
        .set(auth(t.mom))
        .expect(200)
    ).body as Game;
    expect(off.challenges[0]).toMatchObject({
      source: 'builtin',
      difficulty: 'easy',
      points: 10,
    });
    expect(
      new Set(BUILT_IN.map((b) => b.title)).has(off.challenges[0].title),
    ).toBe(true);
  });

  it('organizer can add, edit, remove, start over and switch it off', async () => {
    const t = await trip();
    const g = await game(t, t.mom);
    const post = (token: string, body: unknown) =>
      http
        .post(`/api/trips/${t.id}/selfies/challenges`)
        .set(auth(token))
        .send(body as object);
    await post(t.dad, {
      title: 'Selfie with a boat',
      difficulty: 'easy',
    }).expect(403);
    await post(t.mom, { title: 'x', difficulty: 'easy' }).expect(400);
    await post(t.mom, {
      title: 'Selfie with a boat',
      difficulty: 'extreme',
    }).expect(400);
    await post(t.mom, {
      title: g.challenges[0].title.toUpperCase(),
      difficulty: 'easy',
    }).expect(400);
    const added = (
      await post(t.mom, {
        title: 'Selfie with a boat',
        hint: 'Any boat.',
        difficulty: 'medium',
      }).expect(201)
    ).body as Game;
    expect(added.total).toBe(11);
    expect(added.challenges[10]).toMatchObject({
      title: 'Selfie with a boat',
      hint: 'Any boat.',
      points: 20,
      source: 'custom',
    });

    await http
      .delete(
        `/api/trips/${t.id}/selfies/challenges/${added.challenges[10].id}`,
      )
      .set(auth(t.dad))
      .expect(403);
    const removed = (
      await http
        .delete(
          `/api/trips/${t.id}/selfies/challenges/${added.challenges[10].id}`,
        )
        .set(auth(t.mom))
        .expect(200)
    ).body as Game;
    expect(removed.total).toBe(10);

    // A whole new list, while nobody has played.
    await http
      .post(`/api/trips/${t.id}/selfies/regenerate`)
      .set(auth(t.dad))
      .expect(403);
    const anew = (
      await http
        .post(`/api/trips/${t.id}/selfies/regenerate`)
        .set(auth(t.mom))
        .expect(200)
    ).body as Game;
    expect(anew.total).toBe(10);
    expect(anew.challenges[0].id).not.toBe(g.challenges[0].id);
    await selfie(t, t.dad, anew.challenges[0].id).expect(201);
    await http
      .post(`/api/trips/${t.id}/selfies/regenerate`)
      .set(auth(t.mom))
      .expect(409);

    // Switched off: nothing to see or play; back on: the points are still there.
    await http
      .put(`/api/trips/${t.id}/selfies/state`)
      .set(auth(t.dad))
      .send({ on: false })
      .expect(403);
    const off = (
      await http
        .put(`/api/trips/${t.id}/selfies/state`)
        .set(auth(t.mom))
        .send({ on: false })
        .expect(200)
    ).body as Game;
    expect(off).toMatchObject({ status: 'off', challenges: [], total: 0 });
    await selfie(t, t.dad, anew.challenges[1].id).expect(409);
    const on = (
      await http
        .put(`/api/trips/${t.id}/selfies/state`)
        .set(auth(t.mom))
        .send({ on: true })
        .expect(200)
    ).body as Game;
    expect(on.status).toBe('open');
    expect(on.scoreboard[0]).toMatchObject({ points: 15 });
  });

  it('is only open around the trip, and shows the winner afterwards', async () => {
    const later = await trip(10, 14);
    expect(await game(later, later.mom)).toMatchObject({
      status: 'before',
      challenges: [],
      total: 0,
    });
    expect(calls).toHaveLength(0);

    // The day before: the list is ready for the organizer to look over.
    const tomorrow = await trip(1, 4);
    expect((await game(tomorrow, tomorrow.mom)).status).toBe('open');

    const t = await trip(-2, 0);
    const g = await game(t, t.mom);
    await selfie(t, t.kid, g.challenges[0].id).expect(201);
    await selfie(t, t.dad, g.challenges[9].id).expect(201);
    // The trip ended days ago.
    await ds.query(
      `UPDATE trip SET "startDate" = $1, "endDate" = $2 WHERE id = $3`,
      [iso(-9), iso(-5), t.id],
    );
    const over = await game(t, t.kid);
    expect(over.status).toBe('closed');
    expect(over.winner).toMatchObject({ member: { name: 'Dad' }, points: 35 });
    expect(over.scoreboard.map((r) => r.member.name)).toEqual(['Dad', 'Kid']);
    expect(over.total).toBe(10);
    await selfie(t, t.kid, g.challenges[1].id).expect(409);
    // A trip that ended without ever opening the game gets no list written afterwards.
    const never = await trip(-20, -15);
    expect(await game(never, never.mom)).toMatchObject({
      status: 'closed',
      total: 0,
      winner: null,
    });
    expect(
      await ds.query(`SELECT 1 FROM selfie_challenge WHERE "tripId" = $1`, [
        never.id,
      ]),
    ).toHaveLength(0);
  });

  it('is not for gatherings, and other trips are kept out', async () => {
    const g = await trip(0, 0, { kind: 'gathering', name: 'Thanksgiving' });
    expect(await game(g, g.mom)).toMatchObject({ status: 'off', total: 0 });
    await http
      .put(`/api/trips/${g.id}/selfies/state`)
      .set(auth(g.mom))
      .send({ on: true })
      .expect(409);

    const a = await trip();
    const b = await trip();
    const ga = await game(a, a.mom);
    await http.get(`/api/trips/${a.id}/selfies`).set(auth(b.mom)).expect(403);
    await http.get(`/api/trips/${a.id}/selfies`).expect(401);
    await selfie(a, b.mom, ga.challenges[0].id).expect(403);
    // Another trip's challenge id through your own trip: not found.
    await game(b, b.mom);
    await selfie(b, b.mom, ga.challenges[0].id).expect(404);
    await http
      .post(
        `/api/trips/${b.id}/selfies/challenges/${ga.challenges[0].id}/replace`,
      )
      .set(auth(b.mom))
      .expect(404);
  });

  it('rejects a file that is not a photo, and deleting the photo removes the points', async () => {
    const t = await trip();
    const g = await game(t, t.mom);
    await http
      .post(
        `/api/trips/${t.id}/selfies/challenges/${g.challenges[0].id}/entries`,
      )
      .set(auth(t.dad))
      .field('batchId', 'selfie-batch-1')
      .attach('original', Buffer.from('definitely not an image at all'), {
        filename: 'x.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect((await game(t, t.dad)).me.done).toBe(0);
    const ok = await selfie(t, t.dad, g.challenges[0].id).expect(201);
    expect((await game(t, t.dad)).me.points).toBe(15);
    await http
      .delete(`/api/trips/${t.id}/photos/${ok.body.entry.photo.id}`)
      .set(auth(t.dad))
      .expect(204);
    expect((await game(t, t.dad)).me).toEqual({
      points: 0,
      done: 0,
      rank: null,
    });
  });
});
