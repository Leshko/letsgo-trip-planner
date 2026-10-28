import { Injectable, inject, signal } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { ApiService } from './api.service';
import { InstallService } from './install.service';

const FLAG = 'letsgo.push';

/** Wraps the service worker's push subscription for this device. */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly swPush = inject(SwPush);
  private readonly api = inject(ApiService);
  private readonly install = inject(InstallService);

  /** False in dev (service worker off) and in browsers without push. */
  readonly supported = this.swPush.isEnabled && 'PushManager' in window && 'Notification' in window;
  readonly permission = signal<NotificationPermission>(typeof Notification === 'undefined' ? 'denied' : Notification.permission);
  readonly subscribed = signal(false);
  readonly busy = signal(false);
  readonly iosNeedsInstall = this.install.isIos && !this.install.installed();

  constructor() {
    if (!this.supported) return;
    this.swPush.subscription.subscribe((s) => this.subscribed.set(!!s));
    // The browser can rotate a subscription under us; keep the server current.
    this.swPush.pushSubscriptionChanges.subscribe(({ newSubscription }) => {
      if (newSubscription) void this.register(newSubscription);
    });
  }

  /** On app start: if this device is subscribed, make sure the server has it under the current member. */
  async sync(): Promise<void> {
    if (!this.supported) return;
    try {
      const sub = await firstSub(this.swPush);
      if (sub) await this.register(sub);
    } catch {
      /* offline or signed out; nothing to do */
    }
  }

  /** Must be called from a tap handler (iOS requires a user gesture). */
  async enable(): Promise<boolean> {
    if (!this.supported) return false;
    this.busy.set(true);
    try {
      const { publicKey } = await this.api.pushPublicKey();
      const existing = await firstSub(this.swPush);
      if (existing && keyOf(existing) !== publicKey) await this.swPush.unsubscribe().catch(() => undefined);
      const sub = await this.swPush.requestSubscription({ serverPublicKey: publicKey });
      await this.register(sub);
      this.permission.set('granted');
      this.subscribed.set(true);
      try {
        localStorage.setItem(FLAG, '1');
      } catch {
        /* ignore */
      }
      return true;
    } catch (e) {
      if ((e as { name?: string }).name === 'NotAllowedError' || Notification.permission === 'denied') this.permission.set('denied');
      throw e;
    } finally {
      this.busy.set(false);
    }
  }

  async disable(): Promise<void> {
    if (!this.supported) return;
    this.busy.set(true);
    try {
      const sub = await firstSub(this.swPush);
      if (sub) await this.api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
      await this.swPush.unsubscribe().catch(() => undefined);
      this.subscribed.set(false);
      try {
        localStorage.removeItem(FLAG);
      } catch {
        /* ignore */
      }
    } finally {
      this.busy.set(false);
    }
  }

  private async register(sub: PushSubscription): Promise<void> {
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.['p256dh'] || !json.keys?.['auth']) return;
    await this.api.pushSubscribe({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys['p256dh'], auth: json.keys['auth'] },
      userAgent: navigator.userAgent.slice(0, 300),
    });
  }
}

function firstSub(swPush: SwPush): Promise<PushSubscription | null> {
  return new Promise((resolve) => {
    const s = swPush.subscription.subscribe((v) => {
      resolve(v);
      setTimeout(() => s.unsubscribe(), 0);
    });
  });
}

/** The VAPID key a subscription was created with, base64url, for comparing with the server's. */
function keyOf(sub: PushSubscription): string {
  const raw = sub.options.applicationServerKey;
  if (!raw) return '';
  const bytes = new Uint8Array(raw);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
