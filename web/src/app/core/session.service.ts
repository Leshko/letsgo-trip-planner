import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Member, Session, Trip } from './models';

const TOKEN_KEY = 'letsgo.token';

/** Who I am and which trip I'm in. Persisted as a single token in localStorage. */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly api = inject(ApiService);

  readonly token = signal<string | null>(readToken());
  readonly member = signal<Member | null>(null);
  readonly trip = signal<Trip | null>(null);
  readonly ready = signal(false);

  readonly isSignedIn = computed(() => !!this.token() && !!this.member());
  readonly tripId = computed(() => this.trip()?.id ?? '');

  /** Resolve the stored token into a member + trip. Safe to call repeatedly. */
  async restore(): Promise<boolean> {
    if (this.ready()) return this.isSignedIn();
    const token = this.token();
    if (!token) {
      this.ready.set(true);
      return false;
    }
    try {
      const me = await this.api.me();
      this.member.set(me.member);
      this.trip.set(me.trip);
      return true;
    } catch {
      this.signOut();
      return false;
    } finally {
      this.ready.set(true);
    }
  }

  start(session: Session): void {
    writeToken(session.token);
    this.token.set(session.token);
    this.member.set(session.member);
    this.trip.set(session.trip);
    this.ready.set(true);
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
