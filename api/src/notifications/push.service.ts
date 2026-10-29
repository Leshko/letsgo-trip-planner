import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as webPush from 'web-push';
import { Member, PushSubscription } from '../entities';
import { dataDir } from '../common/paths';
import { publicUrl } from '../auth/auth.config';

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Pluggable sender so tests never touch the network. */
export interface PushSender {
  send(target: PushTarget, payload: string): Promise<void>;
}
export const PUSH_SENDER = Symbol('PUSH_SENDER');

@Injectable()
export class WebPushSender implements PushSender {
  async send(target: PushTarget, payload: string): Promise<void> {
    if (process.env.PUSH_DISABLED === '1') return;
    await webPush.sendNotification(target, payload, {
      TTL: 3600,
      urgency: 'normal',
    });
  }
}

export interface SubscribeInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}

@Injectable()
export class PushService implements OnModuleInit {
  private readonly log = new Logger(PushService.name);
  private _publicKey = '';

  constructor(
    @InjectRepository(PushSubscription)
    private readonly subs: Repository<PushSubscription>,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  get publicKey(): string {
    return this._publicKey;
  }

  /** VAPID keys: env wins; else a file next to the database; else generate once and save it. */
  onModuleInit() {
    let pub = process.env.VAPID_PUBLIC_KEY ?? '';
    let priv = process.env.VAPID_PRIVATE_KEY ?? '';
    const file = join(dataDir(), 'vapid.json');
    if (!pub || !priv) {
      if (existsSync(file)) {
        try {
          const saved = JSON.parse(readFileSync(file, 'utf8')) as {
            publicKey?: string;
            privateKey?: string;
          };
          pub = saved.publicKey ?? '';
          priv = saved.privateKey ?? '';
        } catch (e) {
          this.log.warn(`Could not read ${file}: ${String(e)}`);
        }
      }
    }
    if (!pub || !priv) {
      const keys = webPush.generateVAPIDKeys();
      pub = keys.publicKey;
      priv = keys.privateKey;
      if (process.env.DB_PATH !== ':memory:') {
        try {
          writeFileSync(
            file,
            JSON.stringify({ publicKey: pub, privateKey: priv }, null, 2),
            { mode: 0o600 },
          );
          this.log.log(`Generated VAPID keys at ${file}`);
        } catch (e) {
          this.log.error(
            `Could not save VAPID keys to ${file}; subscriptions will break on restart: ${String(e)}`,
          );
        }
      }
    }
    webPush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? 'mailto:letsgo@example.com',
      pub,
      priv,
    );
    this._publicKey = pub;
  }

  /**
   * Save this device's subscription. Turning notifications on at the app's
   * main address replaces that person's subscriptions from older addresses,
   * so a phone that moved doesn't get everything twice.
   */
  async upsert(me: Member, input: SubscribeInput, origin = ''): Promise<void> {
    const main = mainOrigin();
    if (main && origin === main)
      await this.subs.delete({
        memberId: me.id,
        origin: Not(main),
        endpoint: Not(input.endpoint),
      });
    const existing = await this.subs.findOne({
      where: { endpoint: input.endpoint },
    });
    if (existing) {
      existing.memberId = me.id;
      existing.p256dh = input.keys.p256dh;
      existing.auth = input.keys.auth;
      existing.userAgent = (input.userAgent ?? '').slice(0, 300);
      existing.origin = origin.slice(0, 200);
      await this.subs.save(existing);
      return;
    }
    await this.subs.save(
      this.subs.create({
        memberId: me.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: (input.userAgent ?? '').slice(0, 300),
        origin: origin.slice(0, 200),
      }),
    );
  }

  async remove(me: Member, endpoint: string): Promise<void> {
    await this.subs.delete({ endpoint, memberId: me.id });
  }

  async removeAllFor(memberId: string): Promise<void> {
    await this.subs.delete({ memberId });
  }

  /** Fire-and-forget delivery; dead endpoints (404/410) are dropped. */
  async sendToMembers(memberIds: string[], payload: object): Promise<void> {
    if (!memberIds.length) return;
    const rows = await this.subs.find({ where: { memberId: In(memberIds) } });
    if (!rows.length) return;
    const body = JSON.stringify(payload);
    await Promise.all(
      rows.map(async (row) => {
        try {
          await this.sender.send(
            {
              endpoint: row.endpoint,
              keys: { p256dh: row.p256dh, auth: row.auth },
            },
            body,
          );
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await this.subs.delete({ id: row.id });
          } else if (status === 401 || status === 403) {
            this.log.warn(
              `Push rejected (${status}) for ${row.endpoint.slice(0, 40)}…: VAPID keys may have changed`,
            );
          } else {
            this.log.warn(
              `Push failed for ${row.endpoint.slice(0, 40)}…: ${String(e)}`,
            );
          }
        }
      }),
    );
  }
}

/** The origin (scheme + host) of PUBLIC_URL, or '' when it isn't set. */
function mainOrigin(): string {
  const url = publicUrl();
  try {
    return url ? new URL(url).origin : '';
  } catch {
    return '';
  }
}
