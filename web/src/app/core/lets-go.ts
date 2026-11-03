import { Injectable, computed, inject, signal } from '@angular/core';
import { SessionService } from './session.service';
import { parseIso, todayIso } from './format';

export interface TripDay {
  /** 1-based day of the trip. */
  day: number;
  total: number;
  date: string;
  isFirst: boolean;
  isLast: boolean;
}

const VIEW_KEY = (tripId: string) => `letsgo.planningView.${tripId}`;
const INTRO_KEY = (tripId: string) => `letsgo.letsGoIntro.${tripId}`;

function daysBetween(a: string, b: string): number {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86_400_000);
}

/** Which day of the trip `today` is, or null when the trip isn't on. */
export function tripDayOf(start: string, end: string, today = todayIso()): TripDay | null {
  if (!start || !end || today < start || today > end) return null;
  return {
    day: daysBetween(start, today) + 1,
    total: daysBetween(start, end) + 1,
    date: today,
    isFirst: today === start,
    isLast: today === end,
  };
}

/**
 * "Let's Go" mode: from the first day of the trip to the last (by this
 * phone's calendar) the app leads with today, the map, the wall and photos.
 * Anyone can switch back to the planning layout; that choice stays on this phone.
 */
@Injectable({ providedIn: 'root' })
export class LetsGoService {
  private readonly session = inject(SessionService);
  private readonly today = signal(todayIso());
  /** Bumped when a per-phone choice changes so computeds re-read storage. */
  private readonly prefs = signal(0);

  readonly tripDay = computed<TripDay | null>(() => {
    const t = this.session.trip();
    return t ? tripDayOf(t.startDate, t.endDate, this.today()) : null;
  });

  readonly planningView = computed(() => {
    this.prefs();
    const id = this.session.tripId();
    return !!id && read(VIEW_KEY(id)) === '1';
  });

  /** The Let's Go layout is showing. */
  readonly active = computed(() => !!this.tripDay() && !this.planningView());

  readonly introPending = computed(() => {
    this.prefs();
    const id = this.session.tripId();
    return this.active() && !!id && !read(INTRO_KEY(id));
  });

  constructor() {
    // Midnight passes while the app is open; check the date every minute.
    setInterval(() => {
      const t = todayIso();
      if (t !== this.today()) this.today.set(t);
    }, 60_000);
  }

  setPlanningView(on: boolean): void {
    write(VIEW_KEY(this.session.tripId()), on ? '1' : null);
    this.prefs.update((n) => n + 1);
  }

  markIntroSeen(): void {
    write(INTRO_KEY(this.session.tripId()), '1');
    this.prefs.update((n) => n + 1);
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
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode: the choice just isn't remembered */
  }
}
