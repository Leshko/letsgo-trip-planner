import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from './api.service';
import { CapacitorHttp, registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin, Location as NativeLocation } from '@capacitor-community/background-geolocation';
import { LetsGoService, tripDayOf } from './lets-go';
import { apiOrigin, isNativeApp } from './platform';
import { todayIso } from './format';
import { SessionService } from './session.service';

export interface MyPosition {
  lat: number;
  lng: number;
  accuracy: number;
  at: number;
}

export type LocationProblem = '' | 'denied' | 'unavailable' | 'unsupported';

/** Send at most this often while standing still... */
const MIN_GAP_MS = 30_000;
/** ...or sooner after moving this far. */
const MOVE_M = 50;
/** Re-send while the app stays open, so "last seen" stays current. */
const HEARTBEAT_MS = 60_000;

/** This phone's time zone (e.g. America/Los_Angeles); the trip ends at midnight there. */
export function phoneTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** The phone apps' location service; keeps running when the app is in the background. */
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

/**
 * Shares this phone's position with the family while the person has opted in
 * and the trip is on. In a browser that's only while the app is open (web
 * apps can't read the location in the background). In the phone apps it
 * keeps going with the app closed, until it's switched off or the trip ends.
 */
@Injectable({ providedIn: 'root' })
export class LiveLocationService {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly letsGo = inject(LetsGoService);

  /** In the iPhone/Android app: sharing continues in the background. */
  readonly native = isNativeApp();
  readonly supported = this.native || (typeof navigator !== 'undefined' && 'geolocation' in navigator);
  readonly position = signal<MyPosition | null>(null);
  readonly problem = signal<LocationProblem>(this.supported ? '' : 'unsupported');
  readonly busy = signal(false);

  /** This person has opted in on this trip (from the server's member list). */
  readonly sharing = computed(() => {
    const me = this.session.member();
    const t = this.session.trip();
    if (!me || !t) return false;
    return t.members.find((m) => m.id === me.id)?.sharesLocation ?? !!me.sharesLocation;
  });

  private readonly visible = signal(typeof document === 'undefined' || document.visibilityState === 'visible');
  private watchId: number | null = null;
  private nativeWatcher: string | null = null;
  private pendingFix: { resolve: (p: MyPosition) => void; reject: (e: Error) => void } | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastSent: MyPosition | null = null;
  private sending = false;
  private tripOfWatch = '';

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => this.visible.set(document.visibilityState === 'visible'));
    }
    // Midnight after the last day: stop, and catch up with the server, which
    // switches everyone off and deletes the spots within a few minutes.
    let hadTripDay = !!this.letsGo.tripDay();
    effect(() => {
      const onTrip = !!this.letsGo.tripDay();
      if (hadTripDay && !onTrip) {
        untracked(() => {
          this.stop();
          this.position.set(null);
          setTimeout(() => void this.session.refreshTrip().catch(() => undefined), 6 * 60_000);
        });
      }
      hadTripDay = onTrip;
    });
    effect(() => {
      // The apps keep sharing in the background; a browser only while it's on screen.
      const on = this.sharing() && !!this.letsGo.tripDay() && (this.native || this.visible());
      const tripId = this.session.tripId();
      untracked(() => {
        if (on && tripId !== this.tripOfWatch) this.stop();
        if (on) this.start(tripId);
        else this.stop();
      });
    });
  }

  /** Ask for permission, then switch sharing on and send the first position right away. */
  async enable(): Promise<void> {
    this.busy.set(true);
    try {
      const pos = this.native ? await this.nativeFirstFix() : await this.currentPosition();
      const m = await this.api.setLocationSharing(this.session.tripId(), true, phoneTimeZone()).catch((e) => {
        this.stop();
        throw e;
      });
      this.session.setMember(m);
      await this.session.refreshTrip();
      this.position.set(pos);
      await this.send(pos, true);
    } finally {
      this.busy.set(false);
    }
  }

  async disable(): Promise<void> {
    this.busy.set(true);
    try {
      const m = await this.api.setLocationSharing(this.session.tripId(), false, phoneTimeZone());
      this.session.setMember(m);
      await this.session.refreshTrip();
      this.stop();
    } finally {
      this.busy.set(false);
    }
  }

  /** Phone settings for LetsGo (when location was refused). Apps only. */
  async openSettings(): Promise<void> {
    if (this.native) await BackgroundGeolocation.openSettings().catch(() => undefined);
  }

  /** One reading for the "Me" button, without sharing it. */
  async locateOnce(): Promise<MyPosition> {
    const pos = await this.currentPosition();
    this.position.set(pos);
    return pos;
  }

  private currentPosition(): Promise<MyPosition> {
    if (!this.supported) {
      this.problem.set('unsupported');
      return Promise.reject(new Error("This browser can't share a location."));
    }
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          this.problem.set('');
          resolve(toPosition(p));
        },
        (err) => {
          this.problem.set(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable');
          reject(
            new Error(
              err.code === err.PERMISSION_DENIED
                ? 'Location is blocked for this site.'
                : "Couldn't find your location. Try again outside or with Wi-Fi on.",
            ),
          );
        },
        { enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 },
      );
    });
  }

  /** Still a trip day here? Checked on every reading, since timers sleep in the background. */
  private stillOnTrip(): boolean {
    const t = this.session.trip();
    return !!t && !!tripDayOf(t.startDate, t.endDate, todayIso());
  }

  /** Start the apps' background watcher and wait for the first reading (this is when the phone asks permission). */
  private nativeFirstFix(): Promise<MyPosition> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingFix = null;
        reject(new Error("Couldn't find your location. Try again outside or with Wi-Fi on."));
      }, 45_000);
      this.pendingFix = {
        resolve: (p) => (clearTimeout(timer), resolve(p)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      };
      void this.startNative(this.session.tripId());
    });
  }

  private async startNative(tripId: string) {
    if (this.nativeWatcher !== null) return;
    this.tripOfWatch = tripId;
    this.nativeWatcher = 'starting';
    try {
      const id = await BackgroundGeolocation.addWatcher(
        {
          backgroundTitle: 'Sharing your location with the family',
          backgroundMessage: 'LetsGo Together family map. Turn it off in the app any time; it stops after the trip.',
          requestPermissions: true,
          stale: false,
          distanceFilter: 25,
        },
        (loc?: NativeLocation, err?: { code?: string; message?: string }) => {
          if (err) {
            const denied = err.code === 'NOT_AUTHORIZED';
            this.problem.set(denied ? 'denied' : 'unavailable');
            const e = new Error(denied ? 'Location is off for LetsGo in your phone settings.' : "Couldn't find your location.");
            if (this.pendingFix) {
              this.pendingFix.reject(e);
              this.pendingFix = null;
              this.stop();
            }
            return;
          }
          if (!loc) return;
          if (!this.stillOnTrip()) {
            this.stop();
            return;
          }
          this.problem.set('');
          const pos: MyPosition = { lat: loc.latitude, lng: loc.longitude, accuracy: loc.accuracy ?? 0, at: Date.now() };
          this.position.set(pos);
          if (this.pendingFix) {
            this.pendingFix.resolve(pos);
            this.pendingFix = null;
            return;
          }
          void this.send(pos);
        },
      );
      if (this.nativeWatcher !== 'starting') {
        // Switched off while the phone was still starting it.
        void BackgroundGeolocation.removeWatcher({ id }).catch(() => undefined);
        return;
      }
      this.nativeWatcher = id;
      // While the app is open, refresh "last seen" even when standing still.
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        const pos = this.position();
        if (pos && document.visibilityState === 'visible') void this.send({ ...pos, at: Date.now() }, true);
      }, HEARTBEAT_MS);
    } catch (e) {
      this.nativeWatcher = null;
      this.pendingFix?.reject(e instanceof Error ? e : new Error(String(e)));
      this.pendingFix = null;
    }
  }

  private start(tripId: string) {
    if (this.native) {
      void this.startNative(tripId);
      return;
    }
    if (this.watchId !== null || !this.supported) return;
    this.tripOfWatch = tripId;
    this.watchId = navigator.geolocation.watchPosition(
      (p) => {
        this.problem.set('');
        const pos = toPosition(p);
        this.position.set(pos);
        void this.send(pos);
      },
      (err) => this.problem.set(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 60_000 },
    );
    this.heartbeat = setInterval(() => {
      const pos = this.position();
      if (pos) void this.send({ ...pos, at: Date.now() }, true);
    }, HEARTBEAT_MS);
  }

  private stop() {
    if (this.watchId !== null && !this.native && this.supported) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    const w = this.nativeWatcher;
    this.nativeWatcher = null;
    if (w && w !== 'starting') void BackgroundGeolocation.removeWatcher({ id: w }).catch(() => undefined);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.lastSent = null;
    this.tripOfWatch = '';
  }

  private async send(pos: MyPosition, force = false) {
    const tripId = this.session.tripId();
    if (!tripId || this.sending) return;
    const last = this.lastSent;
    if (!force && last && pos.at - last.at < MIN_GAP_MS && metresBetween(last, pos) < MOVE_M) return;
    this.sending = true;
    const body = { lat: pos.lat, lng: pos.lng, accuracy: Math.round(pos.accuracy), timeZone: phoneTimeZone() };
    try {
      if (this.native) {
        // Native networking: Android slows the web view's own requests while the app is in the background.
        const res = await CapacitorHttp.put({
          url: `${apiOrigin()}/api/trips/${tripId}/me/location`,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.session.token() ?? ''}` },
          data: body,
        });
        if (res.status === 409) throw new HttpErrorResponse({ status: 409 });
        if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
      } else {
        await this.api.sendLocation(tripId, body);
      }
      this.lastSent = pos;
    } catch (e) {
      // Switched off on another device, or the trip ended: catch up with the server.
      if (e instanceof HttpErrorResponse && e.status === 409) {
        this.stop();
        await this.session.refreshTrip().catch(() => undefined);
      }
    } finally {
      this.sending = false;
    }
  }
}

function toPosition(p: GeolocationPosition): MyPosition {
  return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? 0, at: Date.now() };
}
