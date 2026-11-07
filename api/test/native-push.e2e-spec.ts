import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PUSH_SENDER } from '../src/notifications/push.service';
import {
  NATIVE_PUSH_SENDER,
  NativeKind,
  NativeMessage,
  apnsConfig,
  fcmConfig,
  parseP8,
} from '../src/notifications/native-push';
import { freshDatabase } from './db';
import { organizer } from './accounts';

const IOS_TOKEN = 'a'.repeat(64);
const ANDROID_TOKEN = 'fcm-token_' + 'b'.repeat(140) + ':APA91';

describe('native push (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let notif: NotificationsService;
  const web = { send: jest.fn(() => Promise.resolve()) };
  const native = {
    on: { apns: true, fcm: true } as Record<NativeKind, boolean>,
    gone: new Set<string>(),
    sent: [] as { kind: NativeKind; token: string; msg: NativeMessage }[],
    enabled: (k: NativeKind) => native.on[k],
    send: jest.fn(
      async (kind: NativeKind, token: string, msg: NativeMessage) => {
        await Promise.resolve();
        if (!native.on[kind]) return 'off' as const;
        if (native.gone.has(token)) return 'gone' as const;
        native.sent.push({ kind, token, msg });
        return 'sent' as const;
      },
    ),
  };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    await freshDatabase();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PUSH_SENDER)
      .useValue(web)
      .overrideProvider(NATIVE_PUSH_SENDER)
      .useValue(native)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    notif = app.get(NotificationsService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function trip() {
    const t = await http
      .post('/api/trips')
      .set(await organizer(app))
      .send({
        name: 'Lake Week',
        startDate: '2027-07-01',
        endDate: '2027-07-05',
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

  it('tells the apps which channels are on', async () => {
    native.on = { apns: true, fcm: false };
    expect((await http.get('/api/push/native').expect(200)).body).toEqual({
      ios: true,
      android: false,
    });
    native.on = { apns: true, fcm: true };
  });

  it('registers phone tokens and validates them', async () => {
    const t = await trip();
    await http
      .post('/api/trips/me/push/native')
      .set(auth(t.dad))
      .send({ platform: 'ios', token: IOS_TOKEN })
      .expect(201);
    await http
      .post('/api/trips/me/push/native')
      .set(auth(t.dad))
      .send({ platform: 'ios', token: IOS_TOKEN })
      .expect(201);
    await http
      .post('/api/trips/me/push/native')
      .set(auth(t.dad))
      .send({ platform: 'windows', token: IOS_TOKEN })
      .expect(400);
    await http
      .post('/api/trips/me/push/native')
      .set(auth(t.dad))
      .send({ platform: 'ios', token: 'short' })
      .expect(400);
    await http
      .post('/api/trips/me/push/native')
      .set(auth(t.dad))
      .send({ platform: 'ios', token: 'x y<script>'.repeat(5) })
      .expect(400);
    await http
      .post('/api/trips/me/push/native')
      .send({ platform: 'ios', token: IOS_TOKEN })
      .expect(401);
    const rows = await app
      .get(DataSource)
      .query(`SELECT kind, origin FROM push_subscription WHERE endpoint = $1`, [
        IOS_TOKEN,
      ]);
    expect(rows).toEqual([{ kind: 'apns', origin: 'app:ios' }]);
  });

  it('sends to iPhone, Android and browsers alike, and forgets uninstalled apps', async () => {
    const t = await trip();
    await http
      .post('/api/trips/me/push/native')
      .set(auth(t.dad))
      .send({ platform: 'ios', token: IOS_TOKEN })
      .expect(201);
    await http
      .post('/api/trips/me/push/native')
      .set(auth(t.dad))
      .send({ platform: 'android', token: ANDROID_TOKEN })
      .expect(201);
    await http
      .post('/api/trips/me/push')
      .set(auth(t.dad))
      .send({
        endpoint: 'https://push.example/dad',
        keys: { p256dh: 'p', auth: 'a' },
      })
      .expect(201);
    native.sent.length = 0;
    web.send.mockClear();
    const idea = await http
      .post(`/api/trips/${t.id}/ideas`)
      .set(auth(t.mom))
      .send({ kind: 'activity', title: 'Zip-lining' })
      .expect(201);
    await notif.whenIdle();
    expect(web.send).toHaveBeenCalledTimes(1);
    expect(native.sent.map((s) => s.kind).sort()).toEqual(['apns', 'fcm']);
    const msg = native.sent[0].msg;
    expect(msg.title).toBe('Lake Week');
    expect(msg.body).toBe('Mom suggested Zip-lining');
    expect(msg.tripId).toBe(t.id);
    expect(msg.tag).toBe(`idea:${idea.body.id}`);
    expect(msg.url).toMatch(new RegExp(`^/trip/idea/${idea.body.id}\\?n=`));

    // Dad deleted the Android app: Firebase says the token is gone; it's dropped.
    native.gone.add(ANDROID_TOKEN);
    await http
      .post(`/api/trips/${t.id}/ideas`)
      .set(auth(t.mom))
      .send({ kind: 'activity', title: 'Hike' })
      .expect(201);
    await notif.whenIdle();
    const left = await app
      .get(DataSource)
      .query(
        `SELECT kind FROM push_subscription WHERE "memberId" IN (SELECT id FROM member WHERE "tripId" = $1) ORDER BY kind`,
        [t.id],
      );
    expect(left.map((r: { kind: string }) => r.kind)).toEqual(['apns', 'web']);
  });

  it('keeps phone tokens when the channel is switched off on the server', async () => {
    const t = await trip();
    await http
      .post('/api/trips/me/push/native')
      .set(auth(t.dad))
      .send({ platform: 'android', token: 'keep-' + ANDROID_TOKEN })
      .expect(201);
    native.on = { apns: false, fcm: false };
    await http
      .post(`/api/trips/${t.id}/ideas`)
      .set(auth(t.mom))
      .send({ kind: 'activity', title: 'Swim' })
      .expect(201);
    await notif.whenIdle();
    native.on = { apns: true, fcm: true };
    const rows = await app
      .get(DataSource)
      .query(`SELECT 1 FROM push_subscription WHERE endpoint = $1`, [
        'keep-' + ANDROID_TOKEN,
      ]);
    expect(rows).toHaveLength(1);
  });

  it('a browser subscribing on the main address leaves the phone apps alone', async () => {
    const t = await trip();
    await http
      .post('/api/trips/me/push/native')
      .set(auth(t.dad))
      .send({ platform: 'ios', token: 'c'.repeat(64) })
      .expect(201);
    process.env.PUBLIC_URL = 'https://letsgotogether.app';
    try {
      await http
        .post('/api/trips/me/push')
        .set(auth(t.dad))
        .set('Origin', 'https://letsgotogether.app')
        .send({
          endpoint: 'https://push.example/main',
          keys: { p256dh: 'p', auth: 'a' },
        })
        .expect(201);
    } finally {
      delete process.env.PUBLIC_URL;
    }
    const rows = await app
      .get(DataSource)
      .query(`SELECT 1 FROM push_subscription WHERE endpoint = $1`, [
        'c'.repeat(64),
      ]);
    expect(rows).toHaveLength(1);
    // Signing out of the app removes its token like a browser's.
    await http
      .delete('/api/trips/me/push')
      .set(auth(t.dad))
      .send({ endpoint: 'c'.repeat(64) })
      .expect(204);
    const after = await app
      .get(DataSource)
      .query(`SELECT 1 FROM push_subscription WHERE endpoint = $1`, [
        'c'.repeat(64),
      ]);
    expect(after).toHaveLength(0);
  });
});

describe('native push settings', () => {
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const p8 = ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = {
    project_id: 'letsgo-test',
    client_email: 'push@letsgo-test.iam.gserviceaccount.com',
    private_key: rsa.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
  };

  it('reads the Apple key however it was pasted', () => {
    expect(parseP8(p8)).not.toBeNull();
    expect(parseP8(p8.replace(/\n/g, '\\n'))).not.toBeNull();
    expect(parseP8(p8.replace(/\n/g, ' '))).not.toBeNull();
    expect(
      parseP8(p8.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '')),
    ).not.toBeNull();
    expect(parseP8('not a key')).toBeNull();
    // An RSA key isn't an Apple push key.
    expect(parseP8(account.private_key)).toBeNull();
  });

  it('turns Apple push on only with key, key ID and team ID', () => {
    const env = {
      APNS_KEY: p8,
      APNS_KEY_ID: 'ab12cd34ef',
      APPLE_TEAM_ID: 'ABCDE12345',
    };
    expect(apnsConfig(env)).toMatchObject({
      keyId: 'AB12CD34EF',
      teamId: 'ABCDE12345',
      bundleId: 'app.letsgotogether',
      sandbox: false,
    });
    expect(apnsConfig({ ...env, APNS_SANDBOX: '1' })?.sandbox).toBe(true);
    expect(apnsConfig({ ...env, APNS_KEY_ID: '' })).toBeNull();
    expect(apnsConfig({ ...env, APPLE_TEAM_ID: '' })).toBeNull();
    expect(apnsConfig({ ...env, APNS_KEY: 'junk' })).toBeNull();
    expect(apnsConfig({})).toBeNull();
  });

  it('reads the Firebase service account as JSON or base64', () => {
    const json = JSON.stringify(account);
    expect(fcmConfig({ FCM_SERVICE_ACCOUNT: json })).toMatchObject({
      projectId: 'letsgo-test',
      clientEmail: account.client_email,
    });
    expect(
      fcmConfig({ FCM_SERVICE_ACCOUNT: Buffer.from(json).toString('base64') })
        ?.projectId,
    ).toBe('letsgo-test');
    expect(fcmConfig({ FCM_SERVICE_ACCOUNT: '{"project_id":"x"}' })).toBeNull();
    expect(fcmConfig({ FCM_SERVICE_ACCOUNT: 'garbage' })).toBeNull();
    expect(fcmConfig({})).toBeNull();
  });
});
