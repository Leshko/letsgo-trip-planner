import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { LetsGoService } from '../../core/lets-go';
import { LiveLocationService } from '../../core/live-location.service';
import { ItineraryDay, ItineraryEntry, Photo, Post, SelfieGame } from '../../core/models';
import { addDays, longDate, ordinal, time12 } from '../../core/format';
import { usePolling } from '../../core/polling';
import { AvatarComponent } from '../../shared/avatar.component';
import { IconComponent } from '../../shared/icon.component';
import { AgoPipe } from '../../shared/pipes';
import { messageOf } from '../landing/landing.component';

/** The home screen while the trip is on: today's plan, the family, the wall and the photos. */
@Component({
  selector: 'app-today',
  imports: [RouterLink, FormsModule, AvatarComponent, IconComponent, AgoPipe],
  templateUrl: './today.component.html',
})
export class TodayComponent {
  private readonly api = inject(ApiService);
  readonly session = inject(SessionService);
  readonly letsGo = inject(LetsGoService);
  readonly location = inject(LiveLocationService);

  readonly trip = this.session.trip;
  readonly me = this.session.member;
  readonly day = this.letsGo.tripDay;
  readonly days = signal<ItineraryDay[]>([]);
  readonly posts = signal<Post[]>([]);
  readonly photos = signal<Photo[]>([]);
  readonly loaded = signal(false);
  /** The selfie game, when it's on for this trip. */
  readonly selfies = signal<SelfieGame | null>(null);
  readonly selfieLine = computed(() => {
    const g = this.selfies();
    if (!g) return '';
    if (g.status === 'preparing') return 'Getting your challenges ready…';
    if (!g.me.done) return `${g.total} selfies to hunt for. Points for each one!`;
    const place = g.me.rank ? ` · ${ordinal(g.me.rank)} place` : '';
    return `${g.me.done} of ${g.total} done · ${g.me.points} points${place}`;
  });
  readonly error = signal('');
  readonly posting = signal(false);
  draft = '';

  readonly todayPlan = computed(() => this.entriesFor(this.day()?.date));
  readonly tomorrowPlan = computed(() => {
    const d = this.day();
    return d && !d.isLast ? this.entriesFor(addDays(d.date, 1)) : [];
  });
  readonly sharers = computed(() => (this.trip()?.members ?? []).filter((m) => m.sharesLocation));
  readonly greeting = computed(() => {
    const d = this.day();
    if (!d) return '';
    if (d.isFirst) return "Let's go! The trip starts today.";
    if (d.isLast) return 'Last day. Make it count.';
    return 'Have a great day.';
  });

  readonly time12 = time12;
  readonly longDate = longDate;

  constructor() {
    usePolling(() => this.load(), 15_000);
  }

  async load() {
    const id = this.session.tripId();
    if (!id) return;
    const [days, posts, photos] = await Promise.all([
      this.api.itinerary(id),
      this.api.listPosts(id),
      this.api.listPhotos(id),
    ]);
    this.days.set(days);
    this.posts.set(posts);
    this.photos.set(photos);
    this.loaded.set(true);
    // The game is a bonus: never let it hold up or break Today.
    void this.api
      .selfieGame(id)
      .then((g) => this.selfies.set(g.status === 'open' || g.status === 'preparing' ? g : null))
      .catch(() => undefined);
  }

  private entriesFor(date: string | undefined): ItineraryEntry[] {
    if (!date) return [];
    const entries = this.days().find((d) => d.date === date)?.entries ?? [];
    // Timed entries in time order; untimed ones keep their place at the end.
    return [...entries].sort((a, b) => {
      if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime) || a.position - b.position;
      if (a.startTime) return -1;
      if (b.startTime) return 1;
      return a.position - b.position;
    });
  }

  directions(address: string): string {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }

  async post() {
    const body = this.draft.trim();
    if (!body) return;
    this.posting.set(true);
    this.error.set('');
    try {
      const p = await this.api.createPost(this.session.tripId(), body);
      this.posts.update((all) => [p, ...all]);
      this.draft = '';
    } catch (e: unknown) {
      this.error.set(messageOf(e, "Couldn't post that"));
    } finally {
      this.posting.set(false);
    }
  }
}
