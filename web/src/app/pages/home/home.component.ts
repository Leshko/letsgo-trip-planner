import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { Activity, Idea, Post } from '../../core/models';
import { daysUntil, nights, todayIso } from '../../core/format';
import { usePolling } from '../../core/polling';
import { AvatarComponent } from '../../shared/avatar.component';
import { AvatarStackComponent } from '../../shared/avatar-stack.component';
import { AgoPipe } from '../../shared/pipes';

const ICONS: Record<Activity['type'], string> = {
  joined: '👋',
  idea: '💡',
  vote: '🙌',
  comment: '💬',
  itinerary: '🗓️',
  lodging: '🏡',
  trip: '✈️',
};

@Component({
  selector: 'app-home',
  imports: [RouterLink, AvatarComponent, AvatarStackComponent, AgoPipe],
  templateUrl: './home.component.html',
})
export class HomeComponent {
  private readonly api = inject(ApiService);
  readonly session = inject(SessionService);

  readonly trip = this.session.trip;
  readonly me = this.session.member;
  readonly ideas = signal<Idea[]>([]);
  readonly feed = signal<Activity[]>([]);
  readonly posts = signal<Post[]>([]);
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
    usePolling(() => this.load());
  }

  async load() {
    const id = this.session.tripId();
    if (!id) return;
    const [ideas, feed, posts] = await Promise.all([this.api.listIdeas(id), this.api.activity(id, 25), this.api.listPosts(id)]);
    this.ideas.set(ideas);
    this.feed.set(feed);
    this.posts.set(posts);
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
