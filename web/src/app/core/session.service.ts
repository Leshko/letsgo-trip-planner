import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Account, DEFAULT_NOTIFY_PREFS, KnownTrip, Member, MyTrip, NotifyPrefs, Session, SignedIn, Trip } from './models';

const TOKEN_KEY = 'letsgo.token';
const ACCOUNT_KEY = 'letsgo.account';
/** Every trip and gathering joined on this phone, so one can be open while the others stay a tap away. */
const KNOWN_KEY = 'letsgo.trips';

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
  /** Signed in with a name and photo that follow them everywhere; null until that's set up. */
  readonly profile = computed(() => {
    const p = this.account()?.profile;
    return this.hasAccount() && p?.name ? p : null;
  });
  /** The open one is a gathering: wall and photos, no ideas, plan or family map. */
  readonly isGathering = computed(() => this.trip()?.kind === 'gathering');
  /** "trip" or "gathering", for wording. */
  readonly noun = computed(() => (this.isGathering() ? 'gathering' : 'trip'));
  /** Trips and gatherings joined on this phone (the open one included). */
  readonly known = signal<KnownTrip[]>(readKnown());

  /** Keep the phone's list current with the open trip. */
  private remember(trip: Trip, member: Member, token: string): void {
    const entry: KnownTrip = {
      id: trip.id,
      kind: trip.kind ?? 'trip',
      name: trip.name,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      inviteCode: trip.inviteCode,
      memberName: member.name,
      token,
    };
    const rest = this.known().filter((k) => k.token !== token && k.id !== trip.id);
    const next = [entry, ...rest].slice(0, 50);
    if (JSON.stringify(next) === JSON.stringify(this.known())) return;
    this.known.set(next);
    writeKnown(next);
  }

  private forget(tokens: (string | null)[]): void {
    const gone = new Set(tokens.filter(Boolean));
    if (!gone.size) return;
    const next = this.known().filter((k) => !gone.has(k.token));
    if (next.length === this.known().length) return;
    this.known.set(next);
    writeKnown(next);
  }

  /**
   * Someone opened an invite link or scanned a QR code. If this phone (or the
   * signed-in account) is already in that trip, open it. 'join' means they
   * still need to join.
   */
  async openByCode(code: string): Promise<'open' | 'join'> {
    const want = code.trim().toUpperCase();
    if (!want) return 'join';
    const same = (c: string) => c.toUpperCase() === want;
    if (this.isSignedIn() && same(this.trip()?.inviteCode ?? '')) return 'open';
    const k = this.known().find((x) => same(x.inviteCode));
    if (k && (await this.switchTo(k))) return 'open';
    if (await this.restoreAccount()) {
      const mine = this.account()?.trips.find((t) => same(t.trip.inviteCode));
      if (mine) {
        this.openTrip(mine);
        return 'open';
      }
    }
    return 'join';
  }

  /** Open another trip this phone has joined. False if that spot is gone or can't be reached. */
  async switchTo(k: KnownTrip): Promise<boolean> {
    if (this.token() === k.token && this.isSignedIn()) return true;
    const previous = this.token();
    write(TOKEN_KEY, k.token);
    this.token.set(k.token);
    this.ready.set(false);
    this.unreachable.set(false);
    if (await this.restore(true)) return true;
    // restore() forgets a spot the server no longer accepts. Either way, go back to what was open.
    if (previous && previous !== k.token) {
      write(TOKEN_KEY, previous);
      this.token.set(previous);
      this.unreachable.set(false);
      this.ready.set(false);
      await this.restore(true);
    }
    return false;
  }

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
        this.remember(me.trip, me.member, token);
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
    this.remember(session.trip, session.member, session.token);
    this.unreachable.set(false);
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
    // Trips opened through the account leave with it; spots joined without one stay.
    this.forget((this.account()?.trips ?? []).map((t) => t.token));
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
    const trip = await this.api.getTrip(id);
    this.trip.set(trip);
    const me = this.member();
    const token = this.token();
    if (me && token) this.remember(trip, me, token);
  }

  setTrip(trip: Trip): void {
    this.trip.set(trip);
  }

  setMember(member: Member): void {
    this.member.set(member);
  }

  /** Leave the open trip on this phone (the others it has joined stay). */
  signOut(): void {
    this.forget([this.token()]);
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

function readKnown(): KnownTrip[] {
  try {
    const list = JSON.parse(localStorage.getItem(KNOWN_KEY) ?? '[]') as KnownTrip[];
    return Array.isArray(list) ? list.filter((k) => k && typeof k.token === 'string' && typeof k.id === 'string') : [];
  } catch {
    return [];
  }
}

function writeKnown(list: KnownTrip[]): void {
  try {
    if (list.length) localStorage.setItem(KNOWN_KEY, JSON.stringify(list));
    else localStorage.removeItem(KNOWN_KEY);
  } catch {
    /* private mode: only the open trip is kept */
  }
}
