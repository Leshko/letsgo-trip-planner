import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { SignInOptionsService } from '../../core/signin-options.service';
import { Activity, Idea, Photo, Post } from '../../core/models';
import { daysUntil, nights, todayIso } from '../../core/format';
import { usePolling } from '../../core/polling';
import { AvatarComponent } from '../../shared/avatar.component';
import { AvatarStackComponent } from '../../shared/avatar-stack.component';
import { AgoPipe } from '../../shared/pipes';
import { LetsGoService } from '../../core/lets-go';
import { TodayComponent } from '../today/today.component';

const ICONS: Record<Activity['type'], string> = {
  joined: '👋',
  idea: '💡',
  vote: '🙌',
  comment: '💬',
  itinerary: '🗓️',
  lodging: '🏡',
  trip: '✈️',
  photo: '📷',
  post: '📝',
};

@Component({
  selector: 'app-home',
  imports: [RouterLink, AvatarComponent, AvatarStackComponent, AgoPipe, TodayComponent],
  templateUrl: './home.component.html',
})
export class HomeComponent {
  private readonly api = inject(ApiService);
  readonly session = inject(SessionService);

  readonly trip = this.session.trip;
  readonly me = this.session.member;
  readonly letsGo = inject(LetsGoService);
  private readonly router = inject(Router);
  private readonly signIn = inject(SignInOptionsService);
  private readonly saveDismissed = signal(readDismissed(this.session.tripId()));

  /**
   * Organizers are asked until they save the trip to an account (it can't be
   * dismissed). Everyone else sees a gentle prompt they can put off for two weeks.
   */
  readonly savePrompt = computed(() => {
    const m = this.me();
    if (!m || this.session.accountLinked()) return null;
    if (m.isOwner)
      return {
        organizer: true,
        title: "You're the organizer. Save this trip to your account",
        body: `Sign in once with ${this.signIn.phrase()}. You'll never lose the trip, and you can open it on any device.`,
      };
    if (this.saveDismissed()) return null;
    return {
      organizer: false,
      title: 'Save your spot',
      body: 'Sign in to keep your votes and photos safe and see all your trips on any device.',
    };
  });

  async saveTrip() {
    if (this.session.hasAccount()) {
      await this.api.claimTrip(this.session.token() ?? '').then(
        () => this.session.accountLinked.set(true),
        () => void this.router.navigate(['/trips']),
      );
      return;
    }
    await this.router.navigate(['/signin'], { queryParams: { next: '/trip' } });
  }

  dismissSave() {
    try {
      localStorage.setItem(dismissKey(this.session.tripId()), String(Date.now()));
    } catch {
      /* ignore */
    }
    this.saveDismissed.set(true);
  }
  readonly ideas = signal<Idea[]>([]);
  readonly feed = signal<Activity[]>([]);
  readonly posts = signal<Post[]>([]);
  readonly photos = signal<Photo[]>([]);
  readonly loaded = signal(false);

  readonly topDo = computed(() => this.ideas().filter((i) => i.kind === 'activity').slice(0, 3));
  readonly topEat = computed(() => this.ideas().filter((i) => i.kind === 'food').slice(0, 3));
  readonly latestPost = computed(() => this.posts()[0] ?? null);

  readonly countdown = computed(() => {
    const t = this.trip();
    if (!t) return null;
    const until = daysUntil(t.startDate);
    const today = todayIso();
    if (today > t.endDate) return { label: 'That was a good one.', big: 'Done ✓' };
    if (today >= t.startDate) return { label: "You're there! Have the best time.", big: 'Now 🎉' };
    if (until === 1) return { label: 'Tomorrow! Pack the car.', big: '1 day' };
    return { label: `until ${t.destination || 'the trip'} · ${nights(t.startDate, t.endDate)} nights`, big: `${until} days` };
  });

  readonly icons = ICONS;

  constructor() {
    void this.signIn.load();
    usePolling(() => this.load());
    // Switching back to the planning view shows the planning cards right away.
    let wasActive = this.letsGo.active();
    effect(() => {
      const active = this.letsGo.active();
      if (wasActive && !active) untracked(() => void this.load());
      wasActive = active;
    });
  }

  async load() {
    const id = this.session.tripId();
    if (!id || this.letsGo.active()) return;
    const [ideas, feed, posts, photos] = await Promise.all([
      this.api.listIdeas(id),
      this.api.activity(id, 25),
      this.api.listPosts(id),
      this.api.listPhotos(id),
    ]);
    this.ideas.set(ideas);
    this.feed.set(feed);
    this.posts.set(posts);
    this.photos.set(photos);
    this.loaded.set(true);
  }

  async vote(idea: Idea) {
    const updated = await this.api.toggleVote(this.session.tripId(), idea.id);
    this.ideas.update((all) => all.map((i) => (i.id === updated.id ? updated : i)).sort(byVotes));
  }
}

function byVotes(a: Idea, b: Idea): number {
  return b.voteCount - a.voteCount || a.createdAt.localeCompare(b.createdAt);
}

const dismissKey = (tripId: string) => `letsgo.savePrompt.${tripId}`;

function readDismissed(tripId: string): boolean {
  try {
    const at = Number(localStorage.getItem(dismissKey(tripId)) ?? 0);
    return Date.now() - at < 14 * 24 * 60 * 60_000;
  } catch {
    return false;
  }
}
