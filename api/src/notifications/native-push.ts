import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { KeyObject, createPrivateKey, sign } from 'crypto';
import { ClientHttp2Session, connect } from 'http2';
import { APP_ID, appleTeamId } from '../app-links.controller';

/** Native push channels: Apple's push service for iPhones, Firebase for Android. */
export type NativeKind = 'apns' | 'fcm';

export interface NativeMessage {
  title: string;
  body: string;
  /** In-app path opened when the notification is tapped. */
  url: string;
  tag: string;
  tripId: string;
}

/** 'gone' means the phone uninstalled the app or the token expired: forget it. */
export type NativeResult = 'sent' | 'gone' | 'failed' | 'off';

export interface NativePushSender {
  enabled(kind: NativeKind): boolean;
  send(
    kind: NativeKind,
    token: string,
    msg: NativeMessage,
  ): Promise<NativeResult>;
}
export const NATIVE_PUSH_SENDER = Symbol('NATIVE_PUSH_SENDER');

// ---------- settings (Docker tab) ----------

export interface ApnsConfig {
  key: KeyObject;
  keyId: string;
  teamId: string;
  bundleId: string;
  sandbox: boolean;
}

export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  privateKey: KeyObject;
}

const cache = new Map<string, unknown>();
function memo<T>(key: string, make: () => T): T {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
}

/**
 * The Apple push key (.p8). Unraid fields are one line, so accept the file as
 * pasted, with its line breaks lost or written as \n, or just the middle part.
 */
export function parseP8(raw: string): KeyObject | null {
  const body = raw
    .replace(/\\n/g, '\n')
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]{40,}$/.test(body)) return null;
  const pem = `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
  try {
    const key = createPrivateKey(pem);
    return key.asymmetricKeyType === 'ec' ? key : null;
  } catch {
    return null;
  }
}

export function apnsConfig(
  env: NodeJS.ProcessEnv = process.env,
): ApnsConfig | null {
  const raw = env.APNS_KEY ?? '';
  const keyId = (env.APNS_KEY_ID ?? '').trim().toUpperCase();
  const teamId = appleTeamId(env.APPLE_TEAM_ID);
  if (!raw || !/^[A-Z0-9]{10}$/.test(keyId) || !teamId) return null;
  const key = memo(`apns:${raw}`, () => parseP8(raw));
  if (!key) return null;
  return {
    key,
    keyId,
    teamId,
    bundleId: APP_ID,
    sandbox: env.APNS_SANDBOX === '1',
  };
}

/** The Firebase service account file (JSON), pasted as is or base64-encoded. */
export function fcmConfig(
  env: NodeJS.ProcessEnv = process.env,
): FcmConfig | null {
  const raw = (env.FCM_SERVICE_ACCOUNT ?? '').trim();
  if (!raw) return null;
  return memo(`fcm:${raw}`, () => {
    try {
      const text = raw.startsWith('{')
        ? raw
        : Buffer.from(raw, 'base64').toString('utf8');
      const j = JSON.parse(text) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };
      if (!j.project_id || !j.client_email || !j.private_key) return null;
      return {
        projectId: j.project_id,
        clientEmail: j.client_email,
        privateKey: createPrivateKey(j.private_key.replace(/\\n/g, '\n')),
      };
    } catch {
      return null;
    }
  });
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function jwt(
  header: object,
  claims: object,
  key: KeyObject,
  alg: 'ES256' | 'RS256',
): string {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig =
    alg === 'ES256'
      ? sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' })
      : sign('sha256', Buffer.from(input), key);
  return `${input}.${b64url(sig)}`;
}

// ---------- the real sender ----------

@Injectable()
export class NativePushClient implements NativePushSender, OnModuleDestroy {
  private readonly log = new Logger('NativePush');
  private apnsToken: { value: string; at: number; keyId: string } | null = null;
  private fcmToken: { value: string; exp: number; email: string } | null = null;
  private h2: { session: ClientHttp2Session; host: string } | null = null;

  enabled(kind: NativeKind): boolean {
    if (process.env.PUSH_DISABLED === '1') return false;
    return kind === 'apns' ? !!apnsConfig() : !!fcmConfig();
  }

  onModuleDestroy() {
    this.h2?.session.close();
    this.h2 = null;
  }

  async send(
    kind: NativeKind,
    token: string,
    msg: NativeMessage,
  ): Promise<NativeResult> {
    if (!this.enabled(kind)) return 'off';
    try {
      return kind === 'apns'
        ? await this.sendApns(token, msg)
        : await this.sendFcm(token, msg);
    } catch (e) {
      this.log.warn(`${kind} push failed: ${String(e)}`);
      return 'failed';
    }
  }

  // Apple: HTTP/2, a signed token refreshed every 50 minutes.
  private async sendApns(
    token: string,
    msg: NativeMessage,
  ): Promise<NativeResult> {
    const cfg = apnsConfig()!;
    const now = Math.floor(Date.now() / 1000);
    if (
      !this.apnsToken ||
      this.apnsToken.keyId !== cfg.keyId ||
      now - this.apnsToken.at > 50 * 60
    ) {
      this.apnsToken = {
        value: jwt(
          { alg: 'ES256', kid: cfg.keyId },
          { iss: cfg.teamId, iat: now },
          cfg.key,
          'ES256',
        ),
        at: now,
        keyId: cfg.keyId,
      };
    }
    const host = cfg.sandbox
      ? 'https://api.sandbox.push.apple.com'
      : 'https://api.push.apple.com';
    if (
      !this.h2 ||
      this.h2.host !== host ||
      this.h2.session.closed ||
      this.h2.session.destroyed
    ) {
      this.h2?.session.close();
      const session = connect(host);
      session.on('error', () => undefined);
      session.unref();
      this.h2 = { session, host };
    }
    const body = JSON.stringify({
      aps: {
        alert: { title: msg.title, body: msg.body },
        sound: 'default',
        'thread-id': msg.tripId,
      },
      url: msg.url,
      tripId: msg.tripId,
    });
    const { status, reason } = await new Promise<{
      status: number;
      reason: string;
    }>((resolve, reject) => {
      const req = this.h2!.session.request({
        ':method': 'POST',
        ':path': `/3/device/${encodeURIComponent(token)}`,
        authorization: `bearer ${this.apnsToken!.value}`,
        'apns-topic': cfg.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-collapse-id': msg.tag.slice(0, 64),
        'content-type': 'application/json',
      });
      let status = 0;
      let data = '';
      req.setTimeout(15_000, () => req.close());
      req.on('response', (h) => (status = Number(h[':status'])));
      req.on('data', (c: Buffer) => (data += c.toString()));
      req.on('end', () => {
        let reason = '';
        try {
          reason = (JSON.parse(data) as { reason?: string }).reason ?? '';
        } catch {
          /* empty body on success */
        }
        resolve({ status, reason });
      });
      req.on('error', reject);
      req.end(body);
    });
    if (status === 200) return 'sent';
    if (
      status === 410 ||
      reason === 'BadDeviceToken' ||
      reason === 'Unregistered'
    )
      return 'gone';
    this.log.warn(`Apple push refused (${status} ${reason})`);
    return 'failed';
  }

  // Firebase: HTTP v1 API with a short-lived OAuth token from the service account.
  private async sendFcm(
    token: string,
    msg: NativeMessage,
  ): Promise<NativeResult> {
    const cfg = fcmConfig()!;
    const access = await this.fcmAccessToken(cfg);
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/messages:send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${access}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: msg.title, body: msg.body },
            data: { url: msg.url, tripId: msg.tripId },
            android: {
              priority: 'high',
              notification: { tag: msg.tag.slice(0, 64) },
            },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (res.ok) return 'sent';
    const text = await res.text().catch(() => '');
    if (
      res.status === 404 ||
      /UNREGISTERED|registration-token-not-registered/.test(text)
    )
      return 'gone';
    if (
      res.status === 400 &&
      /INVALID_ARGUMENT/.test(text) &&
      /token/i.test(text)
    )
      return 'gone';
    this.log.warn(
      `Firebase push refused (${res.status}): ${text.slice(0, 200)}`,
    );
    return 'failed';
  }

  private async fcmAccessToken(cfg: FcmConfig): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (
      this.fcmToken &&
      this.fcmToken.email === cfg.clientEmail &&
      this.fcmToken.exp - 60 > now
    ) {
      return this.fcmToken.value;
    }
    const assertion = jwt(
      { alg: 'RS256', typ: 'JWT' },
      {
        iss: cfg.clientEmail,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      },
      cfg.privateKey,
      'RS256',
    );
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok)
      throw new Error(`Google sign-in for push failed (${res.status})`);
    const j = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.fcmToken = {
      value: j.access_token,
      exp: now + j.expires_in,
      email: cfg.clientEmail,
    };
    return j.access_token;
  }
}
