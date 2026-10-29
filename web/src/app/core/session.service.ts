import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Account, DEFAULT_NOTIFY_PREFS, Member, MyTrip, NotifyPrefs, Session, SignedIn, Trip } from './models';

const TOKEN_KEY = 'letsgo.token';
const ACCOUNT_KEY = 'letsgo.account';

/**
 * Who I am and which trip I'm in. The trip is a member token (works with or
 * without an account); the account, when signed in, is a separate token.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly api = inject(ApiService);

  readonly token = signal<string | null>(read(TOKEN_KEY));
  readonly accountToken = signal<string | null>(read(ACCOUNT_KEY));
  readonly account = signal<Account | null>(null);
  /** Whether the open trip spot is saved to an account. */
  readonly accountLinked = signal(false);
  private accountReady = false;
  readonly member = signal<Member | null>(null);
  readonly trip = signal<Trip | null>(null);
  readonly ready = signal(false);
  readonly notifyPrefs = signal<NotifyPrefs>(DEFAULT_NOTIFY_PREFS);
  /** The server couldn't be reached (restarting, offline). The saved trip is kept. */
  readonly unreachable = signal(false);

  readonly isSignedIn = computed(() => !!this.token() && !!this.member());
  readonly hasAccount = computed(() => !!this.accountToken() && !!this.account());
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
        this.accountLinked.set(!!me.accountLinked);
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
    write(TOKEN_KEY, session.token);
    this.token.set(session.token);
    this.member.set(session.member);
    this.trip.set(session.trip);
    this.notifyPrefs.set(DEFAULT_NOTIFY_PREFS);
    this.accountLinked.set(
      session.accountLinked ?? !!this.account()?.trips.some((t) => t.token === session.token),
    );
    // A new or newly joined trip shows up in My trips.
    if (session.accountLinked) void this.restoreAccount(true);
    this.ready.set(true);
  }

  /** Load the signed-in account (and its trips). Safe to call repeatedly. */
  async restoreAccount(force = false): Promise<boolean> {
    if (!this.accountToken()) return false;
    if (this.accountReady && !force) return !!this.account();
    try {
      this.account.set(await this.api.account());
    } catch (e: unknown) {
      if ((e as { status?: number }).status === 401) this.clearAccount();
    } finally {
      this.accountReady = true;
    }
    return !!this.account();
  }

  /**
   * Just signed in: keep the account, and save the trip this device is already
   * in to it. Returns a message when that trip couldn't be saved.
   */
  async startAccount(s: SignedIn): Promise<string> {
    write(ACCOUNT_KEY, s.token);
    this.accountToken.set(s.token);
    let note = '';
    const member = this.token();
    if (member) {
      try {
        await this.api.claimTrip(member);
        this.accountLinked.set(true);
      } catch (e: unknown) {
        const err = e as { status?: number; error?: { message?: string } };
        if (err.status === 404) {
          // This device's trip spot no longer exists on the server; forget it.
          this.signOut();
        } else if (err.status && err.status !== 401) {
          note = err.error?.message ?? '';
        }
      }
    }
    await this.restoreAccount(true);
    return note;
  }

  /** Open one of my trips on this device. */
  openTrip(t: MyTrip): void {
    this.start({ token: t.token, member: t.member, trip: t.trip });
    this.accountLinked.set(true);
  }

  async signOutAccount(): Promise<void> {
    await this.api.accountSignOut().catch(() => undefined);
    // A trip opened through the account leaves with it; a spot joined without one stays.
    if (this.accountLinked()) this.signOut();
    this.clearAccount();
  }

  clearAccount(): void {
    write(ACCOUNT_KEY, null);
    this.accountToken.set(null);
    this.account.set(null);
    this.accountReady = false;
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
    write(TOKEN_KEY, null);
    this.token.set(null);
    this.member.set(null);
    this.trip.set(null);
    this.notifyPrefs.set(DEFAULT_NOTIFY_PREFS);
    this.accountLinked.set(false);
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* private mode: the session simply won't persist */
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}
