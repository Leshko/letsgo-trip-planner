import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { androidFingerprints, appleTeamId } from '../src/app-links.controller';
import { freshDatabase } from './db';

const PRINT = Array.from({ length: 32 }, (_, i) =>
  i.toString(16).padStart(2, '0').toUpperCase(),
).join(':');

describe('app links (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    delete process.env.APPLE_TEAM_ID;
    delete process.env.ANDROID_CERT_SHA256;
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
    delete process.env.APPLE_TEAM_ID;
    delete process.env.ANDROID_CERT_SHA256;
    await app.close();
  });

  it('validates the settings', () => {
    expect(appleTeamId('abcde12345')).toBe('ABCDE12345');
    expect(appleTeamId('short')).toBeNull();
    expect(appleTeamId('')).toBeNull();
    expect(
      androidFingerprints(`${PRINT}, nonsense, ${PRINT.toLowerCase()}`),
    ).toEqual([PRINT, PRINT]);
    expect(androidFingerprints('')).toEqual([]);
  });

  it('serves nothing until the settings are filled in', async () => {
    await http.get('/.well-known/apple-app-site-association').expect(404);
    await http.get('/.well-known/assetlinks.json').expect(404);
  });

  it('serves the Apple file at the site root', async () => {
    process.env.APPLE_TEAM_ID = 'ABCDE12345';
    const r = await http
      .get('/.well-known/apple-app-site-association')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    expect(r.body.applinks.details[0].appIDs).toEqual([
      'ABCDE12345.app.letsgotogether',
    ]);
    expect(r.body.applinks.details[0].components).toContainEqual({
      '/': '/join/*',
    });
  });

  it('serves the Android file at the site root', async () => {
    process.env.ANDROID_CERT_SHA256 = PRINT;
    const r = await http.get('/.well-known/assetlinks.json').expect(200);
    expect(r.body[0].target).toEqual({
      namespace: 'android_app',
      package_name: 'app.letsgotogether',
      sha256_cert_fingerprints: [PRINT],
    });
  });

  it('keeps the API under /api', async () => {
    await http.get('/api/health').expect(200);
  });
});
