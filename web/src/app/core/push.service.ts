import { Injectable, NgZone, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { ApiService } from './api.service';
import { InstallService } from './install.service';
import { isNativeApp, nativePlatform } from './platform';

const FLAG = 'letsgo.push';
const NATIVE_TOKEN = 'letsgo.push.token';

/**
 * This device's push notifications: the service worker's Web Push in a
 * browser, Apple / Firebase push in the phone apps. Same switches either way.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly swPush = inject(SwPush);
  private readonly api = inject(ApiService);
  private readonly install = inject(InstallService);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);

  readonly native = isNativeApp();
  private readonly webSupported = !this.native && this.swPush.isEnabled && 'PushManager' in window && 'Notification' in window;
  /** In the apps: the server can reach this kind of phone (and the build can receive). */
  private readonly nativeReady = signal(false);
  /** A notification that arrived while the app was open (the bell refreshes). */
  readonly nativeMessages = new Subject<{ title: string; body: string }>();

  /** False in dev (service worker off), in browsers without push, and in apps the server can't reach. */
  get supported(): boolean {
    return this.native ? this.nativeReady() : this.webSupported;
  }
  readonly permission = signal<NotificationPermission>(
    this.native || typeof Notification === 'undefined' ? (this.native ? 'default' : 'denied') : Notification.permission,
  );
  readonly subscribed = signal(false);
  readonly busy = signal(false);
  readonly iosNeedsInstall = !this.native && this.install.isIos && !this.install.installed();

  constructor() {
    if (this.native) {
      void this.initNative();
      return;
    }
    if (!this.webSupported) return;
    this.swPush.subscription.subscribe((s) => this.subscribed.set(!!s));
    // The browser can rotate a subscription under us; keep the server current.
    this.swPush.pushSubscriptionChanges.subscribe(({ newSubscription }) => {
      if (newSubscription) void this.register(newSubscription);
    });
  }

  /** On app start: if this device is subscribed, make sure the server has it under the current member. */
  async sync(): Promise<void> {
    if (this.native) {
      await this.ready;
      if (this.nativeReady() && readFlag()) await this.registerNative().catch(() => undefined);
      return;
    }
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
    if (this.native) return this.enableNative();
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
    if (this.native) return this.disableNative();
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

  // ---------- phone apps ----------

  private ready: Promise<void> = Promise.resolve();

  private async initNative() {
    let done!: () => void;
    this.ready = new Promise((r) => (done = r));
    try {
      const platform = nativePlatform();
      const [channels, build] = await Promise.all([
        this.api.pushNativeChannels().catch(() => ({ ios: false, android: false })),
        buildFlags(),
      ]);
      // Android needs the Firebase file in the build too; without it, asking would crash the app.
      const ok = platform === 'ios' ? channels.ios : platform === 'android' ? channels.android && build.androidPush : false;
      if (!ok) return;
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const perm = await PushNotifications.checkPermissions();
      this.permission.set(perm.receive === 'granted' ? 'granted' : perm.receive === 'denied' ? 'denied' : 'default');
      this.subscribed.set(perm.receive === 'granted' && readFlag());
      await PushNotifications.addListener('registration', (t) => void this.onToken(t.value));
      await PushNotifications.addListener('registrationError', (e) => {
        this.pendingToken?.reject(new Error(e.error));
        this.pendingToken = null;
      });
      await PushNotifications.addListener('pushNotificationReceived', (n) =>
        this.zone.run(() => this.nativeMessages.next({ title: n.title ?? '', body: n.body ?? '' })),
      );
      await PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
        const url = (a.notification.data as { url?: string } | undefined)?.url;
        if (url && url.startsWith('/')) this.zone.run(() => void this.router.navigateByUrl(url));
      });
      this.nativeReady.set(true);
    } catch {
      /* push stays off in this app */
    } finally {
      done();
    }
  }

  private async enableNative(): Promise<boolean> {
    await this.ready;
    if (!this.nativeReady()) return false;
    this.busy.set(true);
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      let perm = await PushNotifications.checkPermissions();
      if (perm.receive !== 'granted') perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') {
        this.permission.set('denied');
        throw Object.assign(new Error('Notifications are turned off for LetsGo in your phone settings.'), { name: 'NotAllowedError' });
      }
      this.permission.set('granted');
      await this.registerNative();
      this.subscribed.set(true);
      writeFlag(true);
      return true;
    } finally {
      this.busy.set(false);
    }
  }

  private async disableNative(): Promise<void> {
    this.busy.set(true);
    try {
      const token = readToken();
      if (token) await this.api.pushUnsubscribe(token).catch(() => undefined);
      const { PushNotifications } = await import('@capacitor/push-notifications');
      await PushNotifications.unregister().catch(() => undefined);
      this.subscribed.set(false);
      writeFlag(false);
      writeToken(null);
    } finally {
      this.busy.set(false);
    }
  }

  private pendingToken: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

  /** The phone hands out (or rotates) its push token: pass it to whoever asked, and to the server. */
  private async onToken(token: string) {
    if (this.pendingToken) {
      this.pendingToken.resolve(token);
      this.pendingToken = null;
      return;
    }
    // A rotated token while notifications are on: keep the server current.
    if (readFlag() && token !== readToken()) await this.saveToken(token).catch(() => undefined);
  }

  /** Ask the phone for its push token and give it to the server under the current member. */
  private async registerNative(): Promise<void> {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const token = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingToken = null;
        reject(new Error("The phone didn't hand out a push token. Try again in a minute."));
      }, 20_000);
      this.pendingToken = {
        resolve: (t) => (clearTimeout(timer), resolve(t)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      };
      void PushNotifications.register();
    });
    await this.saveToken(token);
  }

  private async saveToken(token: string) {
    const platform = nativePlatform();
    if (platform === 'web') return;
    await this.api.pushNativeSubscribe(platform, token);
    writeToken(token);
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

/** Flags written into the app bundle by the build (e.g. whether Android push is set up). */
async function buildFlags(): Promise<{ androidPush: boolean }> {
  try {
    const r = await fetch('native.json', { cache: 'no-store' });
    if (!r.ok) return { androidPush: false };
    const j = (await r.json()) as { androidPush?: boolean };
    return { androidPush: !!j.androidPush };
  } catch {
    return { androidPush: false };
  }
}

function readFlag(): boolean {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

function writeFlag(on: boolean): void {
  try {
    if (on) localStorage.setItem(FLAG, '1');
    else localStorage.removeItem(FLAG);
  } catch {
    /* ignore */
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem(NATIVE_TOKEN);
  } catch {
    return null;
  }
}

function writeToken(t: string | null): void {
  try {
    if (t) localStorage.setItem(NATIVE_TOKEN, t);
    else localStorage.removeItem(NATIVE_TOKEN);
  } catch {
    /* ignore */
  }
}
