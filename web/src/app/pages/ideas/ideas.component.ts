import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ShareService } from '../../core/share.service';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { FormCarry, Idea, IdeaKind } from '../../core/models';
import { usePolling } from '../../core/polling';
import { AvatarComponent } from '../../shared/avatar.component';
import { AvatarStackComponent } from '../../shared/avatar-stack.component';
import { AgoPipe } from '../../shared/pipes';
import { IconComponent } from '../../shared/icon.component';
import { PlanSheetComponent } from './plan-sheet.component';
import { IdeaFormComponent } from './idea-form.component';

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
  imports: [FormsModule, RouterLink, AvatarComponent, AvatarStackComponent, AgoPipe, IdeaFormComponent, PlanSheetComponent, IconComponent],
  templateUrl: './ideas.component.html',
})
export class IdeasComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly session = inject(SessionService);
  readonly share = inject(ShareService);

  /** Route segment: /trip/ideas/do or /trip/ideas/eat (bound by the router). */
  readonly seg = input<string>('do', { alias: 'kind' });
  readonly kind = computed<IdeaKind>(() => (this.seg() === 'eat' ? 'food' : 'activity'));
  readonly copy = computed(() => COPY[this.kind()]);
  readonly me = this.session.member;
  readonly ideas = signal<Idea[]>([]);
  readonly loaded = signal(false);

  readonly adding = signal(false);
  readonly carry = signal<FormCarry | null>(null);
  readonly editing = signal<Idea | null>(null);

  readonly planning = signal<Idea | null>(null);
  readonly toast = signal('');

  private lastKind: IdeaKind | null = null;

  constructor() {
    usePolling(() => this.load());
    // Same component instance serves both segments, so reload when the switch flips.
    effect(() => {
      this.kind();
      untracked(() => void this.load());
    });
  }

  onSwitchKind(ev: FormCarry) {
    this.carry.set(ev);
    this.switchTo(ev.kind === 'food' ? 'eat' : 'do');
  }

  switchTo(seg: 'do' | 'eat') {
    void this.router.navigate(['/trip/ideas', seg], { replaceUrl: true });
  }

  async load() {
    const id = this.session.tripId();
    if (!id) return;
    const kind = this.kind();
    if (kind !== this.lastKind) {
      this.lastKind = kind;
      this.loaded.set(false);
      this.adding.set(this.carry()?.kind === kind);
      this.editing.set(null);
    }
    this.ideas.set(await this.api.listIdeas(id, kind));
    this.loaded.set(true);
  }

  async vote(idea: Idea) {
    this.ideas.update((all) =>
      all.map((i) => (i.id === idea.id ? { ...i, votedByMe: !i.votedByMe, voteCount: i.voteCount + (i.votedByMe ? -1 : 1) } : i)),
    );
    const updated = await this.api.toggleVote(this.session.tripId(), idea.id);
    this.ideas.update((all) => all.map((i) => (i.id === updated.id ? updated : i)).sort(byVotes));
  }

  onAdded(idea: Idea) {
    this.ideas.update((all) => [...all, idea].sort(byVotes));
    this.adding.set(false);
    this.flash('Added ✓');
  }

  onEdited(idea: Idea) {
    this.ideas.update((all) => all.map((i) => (i.id === idea.id ? idea : i)).sort(byVotes));
    this.editing.set(null);
    this.flash('Saved ✓');
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

  async shareIdea(i: Idea) {
    const out = await this.share.share({ title: i.title, text: `${i.title} · ${this.session.trip()?.name ?? 'LetsGo'}`, path: `/trip/idea/${i.id}` });
    if (out === 'copied') this.flash('Link copied');
    else if (out === 'failed') this.flash("Couldn't share");
  }

  flash(msg: string) {
    this.toast.set(msg);
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
