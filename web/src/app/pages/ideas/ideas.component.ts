import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { Comment, CostLevel, Idea, IdeaKind } from '../../core/models';
import { dateRangeDays } from './days';
import { usePolling } from '../../core/polling';
import { AvatarComponent } from '../../shared/avatar.component';
import { AvatarStackComponent } from '../../shared/avatar-stack.component';
import { AgoPipe, LongDatePipe } from '../../shared/pipes';
import { messageOf } from '../landing/landing.component';

const COPY: Record<IdeaKind, { title: string; blurb: string; placeholder: string; cta: string; empty: string; voteIco: string }> = {
  activity: {
    title: 'Things to do',
    blurb: 'Pitch it, vote on it, then drop the winners into the plan.',
    placeholder: 'Kayak to the island, mini golf, that hike with the waterfall…',
    cta: 'Suggest an activity',
    empty: 'Nothing on the list yet. What should we do?',
    voteIco: '🙌',
  },
  food: {
    title: 'Places to eat',
    blurb: 'Taco trucks, the fancy night out, breakfast spots. Vote with your stomach.',
    placeholder: 'The taco truck by the marina, pizza night in…',
    cta: 'Add a place',
    empty: 'No restaurants yet. Where should we eat?',
    voteIco: '😋',
  },
};

@Component({
  selector: 'app-ideas',
  imports: [FormsModule, AvatarComponent, AvatarStackComponent, AgoPipe, LongDatePipe],
  templateUrl: './ideas.component.html',
})
export class IdeasComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  readonly session = inject(SessionService);

  readonly kind = toSignal(this.route.data.pipe(map((d) => d['kind'] as IdeaKind)), { initialValue: 'activity' as IdeaKind });
  readonly copy = computed(() => COPY[this.kind()]);
  readonly me = this.session.member;
  readonly ideas = signal<Idea[]>([]);
  readonly loaded = signal(false);
  readonly days = computed(() => {
    const t = this.session.trip();
    return t ? dateRangeDays(t.startDate, t.endDate) : [];
  });

  // add form
  readonly adding = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  title = '';
  description = '';
  link = '';
  address = '';
  cost: CostLevel = '';
  readonly costs: CostLevel[] = ['free', '$', '$$', '$$$'];

  // comments
  readonly openComments = signal<string | null>(null);
  readonly comments = signal<Comment[]>([]);
  commentDraft = '';

  // add to plan
  readonly planning = signal<Idea | null>(null);
  planDate = '';
  planTime = '';
  readonly toast = signal('');

  private lastKind: IdeaKind | null = null;

  constructor() {
    usePolling(() => this.load());
  }

  async load() {
    const id = this.session.tripId();
    if (!id) return;
    const kind = this.kind();
    if (kind !== this.lastKind) {
      this.lastKind = kind;
      this.loaded.set(false);
      this.openComments.set(null);
    }
    this.ideas.set(await this.api.listIdeas(id, kind));
    this.loaded.set(true);
  }

  async vote(idea: Idea) {
    // optimistic flip so the tap feels instant
    this.ideas.update((all) =>
      all.map((i) => (i.id === idea.id ? { ...i, votedByMe: !i.votedByMe, voteCount: i.voteCount + (i.votedByMe ? -1 : 1) } : i)),
    );
    const updated = await this.api.toggleVote(this.session.tripId(), idea.id);
    this.ideas.update((all) => all.map((i) => (i.id === updated.id ? updated : i)).sort(byVotes));
  }

  async add() {
    this.busy.set(true);
    this.error.set('');
    try {
      const idea = await this.api.createIdea(this.session.tripId(), {
        kind: this.kind(),
        title: this.title,
        description: this.description,
        link: this.link,
        address: this.address,
        cost: this.cost,
      });
      this.ideas.update((all) => [...all, idea].sort(byVotes));
      this.title = this.description = this.link = this.address = '';
      this.cost = '';
      this.adding.set(false);
    } catch (e: unknown) {
      this.error.set(messageOf(e, "Couldn't add that"));
    } finally {
      this.busy.set(false);
    }
  }

  canRemove(idea: Idea): boolean {
    const m = this.me();
    return !!m && (m.isOwner || idea.suggestedBy.id === m.id);
  }

  async remove(idea: Idea) {
    if (!confirm(`Remove "${idea.title}"?`)) return;
    await this.api.deleteIdea(this.session.tripId(), idea.id);
    this.ideas.update((all) => all.filter((i) => i.id !== idea.id));
  }

  async toggleComments(idea: Idea) {
    if (this.openComments() === idea.id) {
      this.openComments.set(null);
      return;
    }
    this.openComments.set(idea.id);
    this.comments.set([]);
    this.commentDraft = '';
    this.comments.set(await this.api.listComments(this.session.tripId(), idea.id));
  }

  async comment(idea: Idea) {
    const body = this.commentDraft.trim();
    if (!body) return;
    const c = await this.api.addComment(this.session.tripId(), idea.id, body);
    this.comments.update((all) => [...all, c]);
    this.ideas.update((all) => all.map((i) => (i.id === idea.id ? { ...i, commentCount: i.commentCount + 1 } : i)));
    this.commentDraft = '';
  }

  async deleteComment(idea: Idea, c: Comment) {
    await this.api.deleteComment(this.session.tripId(), c.id);
    this.comments.update((all) => all.filter((x) => x.id !== c.id));
    this.ideas.update((all) => all.map((i) => (i.id === idea.id ? { ...i, commentCount: Math.max(0, i.commentCount - 1) } : i)));
  }

  startPlan(idea: Idea) {
    this.planDate = this.days()[0] ?? '';
    this.planTime = '';
    this.planning.set(idea);
  }

  async addToPlan() {
    const idea = this.planning();
    if (!idea || !this.planDate) return;
    await this.api.addEntry(this.session.tripId(), { date: this.planDate, ideaId: idea.id, startTime: this.planTime || undefined });
    this.planning.set(null);
    this.toast.set(`Added to the plan ✓`);
    setTimeout(() => this.toast.set(''), 1800);
  }

  hostOf(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return 'link';
    }
  }
}

function byVotes(a: Idea, b: Idea): number {
  return b.voteCount - a.voteCount || a.createdAt.localeCompare(b.createdAt);
}
