import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { DEFAULT_NOTIFY_PREFS, Member, NotifyPrefs, Session, Trip } from './models';

const TOKEN_KEY = 'letsgo.token';

/** Who I am and which trip I'm in. Persisted as a single token in localStorage. */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly api = inject(ApiService);

  readonly token = signal<string | null>(readToken());
  readonly member = signal<Member | null>(null);
  readonly trip = signal<Trip | null>(null);
  readonly ready = signal(false);
  readonly notifyPrefs = signal<NotifyPrefs>(DEFAULT_NOTIFY_PREFS);
  /** The server couldn't be reached (restarting, offline). The saved trip is kept. */
  readonly unreachable = signal(false);

  readonly isSignedIn = computed(() => !!this.token() && !!this.member());
  readonly tripId = computed(() => this.trip()?.id ?? '');

  /** Resolve the stored token into a member + trip. Safe to call repeatedly. */
  async restore(force = false): Promise<boolean> {
    if (this.ready()) return this.isSignedIn();
    // Already known to be unreachable: don't make every page wait again; the landing page retries.
    if (this.unreachable() && !force) return false;
    const token = this.token();
    if (!token) {
      this.ready.set(true);
      return false;
    }
    // Only forget the trip when the server says this sign-in is no longer valid.
    // A restart, a tunnel hiccup or a weak signal must never sign anyone out.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const me = await withTimeout(this.api.me(), 8000);
        this.member.set(me.member);
        this.trip.set(me.trip);
        this.notifyPrefs.set({ ...DEFAULT_NOTIFY_PREFS, ...me.notifyPrefs });
        this.unreachable.set(false);
        this.ready.set(true);
        return true;
      } catch (e: unknown) {
        const status = (e as { status?: number }).status ?? 0;
        if (status === 401 || status === 403) {
          this.signOut();
          this.ready.set(true);
          return false;
        }
        if (attempt < 1) await new Promise((r) => setTimeout(r, 1200));
      }
    }
    // Still unreachable: keep the token and try again on the next visit or tap.
    this.unreachable.set(true);
    return false;
  }

  start(session: Session): void {
    writeToken(session.token);
    this.token.set(session.token);
    this.member.set(session.member);
    this.trip.set(session.trip);
    this.notifyPrefs.set(DEFAULT_NOTIFY_PREFS);
    this.ready.set(true);
  }

  setNotifyPrefs(p: NotifyPrefs): void {
    this.notifyPrefs.set(p);
  }

  async refreshTrip(): Promise<void> {
    const id = this.tripId();
    if (!id) return;
    this.trip.set(await this.api.getTrip(id));
  }

  setTrip(trip: Trip): void {
    this.trip.set(trip);
  }

  setMember(member: Member): void {
    this.member.set(member);
  }

  signOut(): void {
    writeToken(null);
    this.token.set(null);
    this.member.set(null);
    this.trip.set(null);
    this.notifyPrefs.set(DEFAULT_NOTIFY_PREFS);
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the session simply won't persist */
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}
