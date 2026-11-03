import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from './api.service';
import { LetsGoService } from './lets-go';
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

export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Shares this phone's position with the family while the person has opted in,
 * the trip is on, and the app is open. Browsers don't let a web app read the
 * location in the background, so closing the app pauses it.
 */
@Injectable({ providedIn: 'root' })
export class LiveLocationService {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly letsGo = inject(LetsGoService);

  readonly supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;
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
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastSent: MyPosition | null = null;
  private sending = false;
  private tripOfWatch = '';

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => this.visible.set(document.visibilityState === 'visible'));
    }
    effect(() => {
      const on = this.sharing() && !!this.letsGo.tripDay() && this.visible();
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
      const pos = await this.currentPosition();
      const m = await this.api.setLocationSharing(this.session.tripId(), true);
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
      const m = await this.api.setLocationSharing(this.session.tripId(), false);
      this.session.setMember(m);
      await this.session.refreshTrip();
      this.stop();
    } finally {
      this.busy.set(false);
    }
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

  private start(tripId: string) {
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
    if (this.watchId !== null && this.supported) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
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
    try {
      await this.api.sendLocation(tripId, { lat: pos.lat, lng: pos.lng, accuracy: Math.round(pos.accuracy) });
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
