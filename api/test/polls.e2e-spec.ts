import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PUSH_SENDER } from '../src/notifications/push.service';
import { freshDatabase } from './db';
import { organizer } from './accounts';

interface PollOption {
  id: string;
  text: string;
  count: number;
  memberIds: string[];
  mine: boolean;
}
interface PostBody {
  id: string;
  body: string;
  poll: {
    multiple: boolean;
    closed: boolean;
    voters: number;
    options: PollOption[];
  } | null;
}

const KEY = 'test-admin-key-0123456789abcdef';

describe('wall polls (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let notif: NotificationsService;
  const pushed: { body: string; url: string }[] = [];
  const sender = {
    send: jest.fn((_t: unknown, payload: string) => {
      const n = (
        JSON.parse(payload) as {
          notification: { body: string; data: { url: string } };
        }
      ).notification;
      pushed.push({ body: n.body, url: n.data.url });
      return Promise.resolve();
    }),
  };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    process.env.ADMIN_KEY = KEY;
    await freshDatabase();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PUSH_SENDER)
      .useValue(sender)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    notif = app.get(NotificationsService);
  });

  afterAll(async () => {
    delete process.env.ADMIN_KEY;
    await app.close();
  });

  async function trip(name = 'Lake Week') {
    const t = await http
      .post('/api/trips')
      .set(await organizer(app))
      .send({
        name,
        startDate: '2027-07-01',
        endDate: '2027-07-05',
        memberName: 'Mom',
      })
      .expect(201);
    const join = async (who: string) =>
      (
        await http
          .post('/api/trips/join')
          .send({ code: t.body.trip.inviteCode, name: who })
          .expect(201)
      ).body as { token: string; member: { id: string } };
    const dad = await join('Dad');
    const kid = await join('Kid');
    return {
      id: t.body.trip.id as string,
      mom: t.body.token as string,
      momId: t.body.member.id as string,
      dad: dad.token,
      dadId: dad.member.id,
      kid: kid.token,
      kidId: kid.member.id,
    };
  }

  const makePoll = async (
    t: { id: string },
    token: string,
    body: string,
    options: string[],
    multiple?: boolean,
  ) =>
    (
      await http
        .post(`/api/trips/${t.id}/posts`)
        .set(auth(token))
        .send({ body, poll: { options, multiple } })
        .expect(201)
    ).body as PostBody;

  const vote = (
    t: { id: string },
    token: string,
    postId: string,
    optionId: string,
  ) =>
    http
      .post(`/api/trips/${t.id}/posts/${postId}/vote`)
      .set(auth(token))
      .send({ optionId });

  it('creates a poll on the wall, cleaning up the options', async () => {
    const t = await trip();
    const p = await makePoll(t, t.mom, 'Pizza or tacos Friday?', [
      ' Pizza ',
      'Tacos',
      'pizza',
      '   ',
    ]);
    expect(p.body).toBe('Pizza or tacos Friday?');
    expect(p.poll).toMatchObject({ multiple: false, closed: false, voters: 0 });
    expect(p.poll!.options.map((o) => o.text)).toEqual(['Pizza', 'Tacos']);
    expect(new Set(p.poll!.options.map((o) => o.id)).size).toBe(2);

    // It sits on the wall with ordinary posts, which have no poll.
    await http
      .post(`/api/trips/${t.id}/posts`)
      .set(auth(t.dad))
      .send({ body: 'Made it!' })
      .expect(201);
    const wall = (
      await http.get(`/api/trips/${t.id}/posts`).set(auth(t.dad)).expect(200)
    ).body as PostBody[];
    expect(wall.map((x) => !!x.poll)).toEqual([false, true]);
  });

  it('refuses polls without two real options, or with too many', async () => {
    const t = await trip();
    const send = (poll: unknown) =>
      http
        .post(`/api/trips/${t.id}/posts`)
        .set(auth(t.mom))
        .send({ body: 'Q?', poll });
    await send({ options: ['Only one'] }).expect(400);
    await send({ options: ['Same', 'same '] }).expect(400);
    await send({ options: ['A', '  '] }).expect(400);
    await send({
      options: Array.from({ length: 11 }, (_, i) => `O${i}`),
    }).expect(400);
    await send({ options: ['A', 'x'.repeat(81)] }).expect(400);
    await send({ options: 'A,B' }).expect(400);
    await send({ options: ['A', 'B'], multiple: 'yes' }).expect(400);
  });

  it('one-answer poll: a vote moves, and tapping your answer takes it back', async () => {
    const t = await trip();
    const p = await makePoll(t, t.mom, 'Pizza or tacos?', ['Pizza', 'Tacos']);
    const [pizza, tacos] = p.poll!.options;

    let r = (await vote(t, t.dad, p.id, pizza.id).expect(200)).body as PostBody;
    expect(r.poll!.options.map((o) => o.count)).toEqual([1, 0]);
    expect(r.poll!.options[0]).toMatchObject({
      mine: true,
      memberIds: [t.dadId],
    });

    r = (await vote(t, t.dad, p.id, tacos.id).expect(200)).body as PostBody;
    expect(r.poll!.options.map((o) => o.count)).toEqual([0, 1]);

    await vote(t, t.kid, p.id, tacos.id).expect(200);
    r = (await vote(t, t.dad, p.id, tacos.id).expect(200)).body as PostBody;
    expect(r.poll!.options.map((o) => o.count)).toEqual([0, 1]);
    expect(r.poll!.voters).toBe(1);
    expect(r.poll!.options[1].mine).toBe(false);

    // Mom sees the same totals, with "mine" from her side.
    const seen = (
      await http
        .get(`/api/trips/${t.id}/posts/${p.id}`)
        .set(auth(t.mom))
        .expect(200)
    ).body as PostBody;
    expect(seen.poll!.options[1]).toMatchObject({
      count: 1,
      mine: false,
      memberIds: [t.kidId],
    });
  });

  it('several-answers poll: each option toggles on its own', async () => {
    const t = await trip();
    const p = await makePoll(
      t,
      t.mom,
      'Which nights work?',
      ['Fri', 'Sat', 'Sun'],
      true,
    );
    const [fri, sat, sun] = p.poll!.options;
    await vote(t, t.dad, p.id, fri.id).expect(200);
    await vote(t, t.dad, p.id, sat.id).expect(200);
    await vote(t, t.kid, p.id, sat.id).expect(200);
    let r = (await vote(t, t.kid, p.id, sun.id).expect(200)).body as PostBody;
    expect(r.poll!.options.map((o) => o.count)).toEqual([1, 2, 1]);
    expect(r.poll!.voters).toBe(2);
    r = (await vote(t, t.dad, p.id, fri.id).expect(200)).body as PostBody;
    expect(r.poll!.options.map((o) => o.count)).toEqual([0, 2, 1]);
  });

  it('counts everyone when the whole family taps at once', async () => {
    const t = await trip();
    const p = await makePoll(t, t.mom, 'Beach day?', ['Yes', 'No']);
    const yes = p.poll!.options[0].id;
    const results = await Promise.all(
      [t.mom, t.dad, t.kid].map((tok) => vote(t, tok, p.id, yes)),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const after = (
      await http
        .get(`/api/trips/${t.id}/posts/${p.id}`)
        .set(auth(t.mom))
        .expect(200)
    ).body as PostBody;
    expect(after.poll!.options[0].count).toBe(3);
    // Reactions on the same post survive simultaneous taps too.
    await Promise.all(
      [t.mom, t.dad, t.kid].map((tok) =>
        http
          .post(`/api/trips/${t.id}/posts/${p.id}/react`)
          .set(auth(tok))
          .send({ emoji: '🎉' })
          .expect(201),
      ),
    );
    const wall = (
      await http.get(`/api/trips/${t.id}/posts`).set(auth(t.mom)).expect(200)
    ).body as (PostBody & { reactions: { emoji: string; count: number }[] })[];
    expect(wall[0].reactions).toEqual([
      expect.objectContaining({ emoji: '🎉', count: 3 }),
    ]);
    expect(wall[0].poll!.options[0].count).toBe(3);
  });

  it('closing stops votes; only the starter or the organizer can close', async () => {
    const t = await trip();
    const p = await makePoll(t, t.dad, 'Hike?', ['Yes', 'No']);
    const yes = p.poll!.options[0].id;
    const close = (token: string, closed: boolean) =>
      http
        .put(`/api/trips/${t.id}/posts/${p.id}/poll`)
        .set(auth(token))
        .send({ closed });
    await close(t.kid, true).expect(403);
    expect((await close(t.dad, true).expect(200)).body.poll.closed).toBe(true);
    await vote(t, t.kid, p.id, yes).expect(409);
    // The organizer can reopen it.
    expect((await close(t.mom, false).expect(200)).body.poll.closed).toBe(
      false,
    );
    await vote(t, t.kid, p.id, yes).expect(200);
    await close(t.mom, 'yes' as unknown as boolean).expect(400);
  });

  it('handles bad requests and keeps other trips out', async () => {
    const t = await trip();
    const other = await trip('Ski');
    const p = await makePoll(t, t.mom, 'Q?', ['A', 'B']);
    const plain = (
      await http
        .post(`/api/trips/${t.id}/posts`)
        .set(auth(t.mom))
        .send({ body: 'Just a post' })
        .expect(201)
    ).body as PostBody;
    const a = p.poll!.options[0].id;
    await vote(t, t.dad, p.id, 'nope').expect(404);
    await vote(t, t.dad, plain.id, a).expect(400);
    await vote(t, t.dad, 'not-a-uuid', a).expect(400);
    await http
      .put(`/api/trips/${t.id}/posts/${plain.id}/poll`)
      .set(auth(t.mom))
      .send({ closed: true })
      .expect(400);
    await http
      .post(`/api/trips/${t.id}/posts/${p.id}/vote`)
      .send({ optionId: a })
      .expect(401);
    await vote(t, other.mom, p.id, a).expect(403);
    await http
      .get(`/api/trips/${t.id}/posts/${p.id}`)
      .set(auth(other.mom))
      .expect(403);
    // Another trip's member can't reach it through their own trip id either.
    await http
      .get(`/api/trips/${other.id}/posts/${p.id}`)
      .set(auth(other.mom))
      .expect(404);
    await vote({ id: other.id }, other.mom, p.id, a).expect(404);
  });

  it('notifies with a link straight to the poll', async () => {
    const t = await trip();
    for (const tok of [t.mom, t.dad])
      await http
        .post('/api/trips/me/push')
        .set(auth(tok))
        .send({
          endpoint: `https://push.example/${tok.slice(0, 8)}`,
          keys: { p256dh: 'p', auth: 'a' },
        })
        .expect(201);
    pushed.length = 0;
    const p = await makePoll(t, t.mom, 'Pizza or tacos Friday?', [
      'Pizza',
      'Tacos',
    ]);
    await notif.whenIdle();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].body).toBe('Mom started a poll: "Pizza or tacos Friday?"');
    expect(pushed[0].url).toMatch(new RegExp(`^/trip/poll/${p.id}\\?n=`));
    const bell = (
      await http
        .get(`/api/trips/${t.id}/notifications`)
        .set(auth(t.kid))
        .expect(200)
    ).body as { items: { url: string; message: string }[] };
    expect(bell.items[0]).toMatchObject({
      url: `/trip/poll/${p.id}`,
      message: 'started a poll: "Pizza or tacos Friday?"',
    });

    // The person who started it hears about votes; taking a vote back is quiet.
    pushed.length = 0;
    await vote(t, t.dad, p.id, p.poll!.options[0].id).expect(200);
    await notif.whenIdle();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].body).toBe(
      'Dad voted on your poll: "Pizza or tacos Friday?"',
    );
    expect(pushed[0].url).toMatch(new RegExp(`^/trip/poll/${p.id}\\?n=`));
    pushed.length = 0;
    await vote(t, t.dad, p.id, p.poll!.options[0].id).expect(200);
    await vote(t, t.mom, p.id, p.poll!.options[1].id).expect(200);
    await notif.whenIdle();
    expect(pushed).toHaveLength(0);
  });

  it('deleting a poll follows the wall rules', async () => {
    const t = await trip();
    const p = await makePoll(t, t.dad, 'Q?', ['A', 'B']);
    await http
      .delete(`/api/trips/${t.id}/posts/${p.id}`)
      .set(auth(t.kid))
      .expect(403);
    await http
      .delete(`/api/trips/${t.id}/posts/${p.id}`)
      .set(auth(t.dad))
      .expect(204);
    await http
      .get(`/api/trips/${t.id}/posts/${p.id}`)
      .set(auth(t.dad))
      .expect(404);
  });

  it("an admin merge carries a rejoined person's poll votes over", async () => {
    const t = await trip();
    const code = (
      (await http.get(`/api/trips/${t.id}`).set(auth(t.mom)).expect(200))
        .body as { inviteCode: string }
    ).inviteCode;
    const again = (
      await http
        .post('/api/trips/join')
        .send({ code, name: 'Dad 2' })
        .expect(201)
    ).body as { token: string; member: { id: string } };
    const single = await makePoll(t, t.mom, 'One?', ['A', 'B']);
    const multi = await makePoll(t, t.mom, 'Many?', ['X', 'Y', 'Z'], true);
    const only = await makePoll(t, t.mom, 'New only?', ['P', 'Q']);
    // Old spot answered A; the new spot answered B. The kept (old) spot's answer wins.
    await vote(t, t.dad, single.id, single.poll!.options[0].id).expect(200);
    await vote(t, again.token, single.id, single.poll!.options[1].id).expect(
      200,
    );
    await vote(t, t.dad, multi.id, multi.poll!.options[0].id).expect(200);
    await vote(t, again.token, multi.id, multi.poll!.options[0].id).expect(200);
    await vote(t, again.token, multi.id, multi.poll!.options[2].id).expect(200);
    await vote(t, again.token, only.id, only.poll!.options[1].id).expect(200);

    await http
      .post(`/api/admin/trips/${t.id}/merge`)
      .set({ 'X-Admin-Key': KEY })
      .send({ fromMemberId: again.member.id, intoMemberId: t.dadId })
      .expect(200);

    const get = async (id: string) =>
      (
        (
          await http
            .get(`/api/trips/${t.id}/posts/${id}`)
            .set(auth(t.dad))
            .expect(200)
        ).body as PostBody
      ).poll!.options.map((o) => o.memberIds);
    expect(await get(single.id)).toEqual([[t.dadId], []]);
    expect(await get(multi.id)).toEqual([[t.dadId], [], [t.dadId]]);
    expect(await get(only.id)).toEqual([[], [t.dadId]]);
  });
});
