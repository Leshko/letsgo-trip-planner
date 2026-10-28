import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { ShareService } from '../../core/share.service';
import { Comment, Idea } from '../../core/models';
import { usePolling } from '../../core/polling';
import { AvatarComponent } from '../../shared/avatar.component';
import { AvatarStackComponent } from '../../shared/avatar-stack.component';
import { IconComponent } from '../../shared/icon.component';
import { AgoPipe } from '../../shared/pipes';
import { IdeaFormComponent } from './idea-form.component';
import { PlanSheetComponent } from './plan-sheet.component';

@Component({
  selector: 'app-idea-detail',
  imports: [FormsModule, RouterLink, AvatarComponent, AvatarStackComponent, IconComponent, AgoPipe, IdeaFormComponent, PlanSheetComponent],
  templateUrl: './idea-detail.component.html',
})
export class IdeaDetailComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  readonly session = inject(SessionService);
  readonly share = inject(ShareService);

  readonly id = input<string>('');
  readonly me = this.session.member;
  readonly idea = signal<Idea | null>(null);
  readonly comments = signal<Comment[]>([]);
  readonly loaded = signal(false);
  readonly missing = signal(false);
  readonly editing = signal(false);
  readonly planning = signal(false);
  readonly toast = signal('');
  commentDraft = '';

  readonly backLink = computed(() => ['/trip/ideas', this.idea()?.kind === 'food' ? 'eat' : 'do']);
  readonly canRemove = computed(() => {
    const m = this.me();
    const i = this.idea();
    return !!m && !!i && (m.isOwner || i.suggestedBy.id === m.id);
  });
  readonly mapUrl = computed<SafeResourceUrl | null>(() => {
    const q = this.idea()?.address?.trim();
    return q ? this.sanitizer.bypassSecurityTrustResourceUrl(`https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`) : null;
  });
  readonly directionsUrl = computed(() => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(this.idea()?.address ?? '')}`);
  readonly inText = computed(() => {
    const i = this.idea();
    if (!i) return '';
    if (i.voteCount === 0) return 'Nobody yet';
    if (i.voteCount === 1) return i.votedByMe ? 'Just you so far' : `${i.voters[0]?.name} is in`;
    return `${i.voteCount} in`;
  });

  constructor() {
    usePolling(() => this.load(), 12_000);
    effect(() => {
      this.id();
      untracked(() => void this.load());
    });
  }

  async load() {
    const tripId = this.session.tripId();
    if (!tripId || !this.id()) return;
    try {
      const [idea, comments] = await Promise.all([this.api.getIdea(tripId, this.id()), this.api.listComments(tripId, this.id())]);
      this.idea.set(idea);
      this.comments.set(comments);
      this.missing.set(false);
    } catch (e: unknown) {
      if ((e as { status?: number }).status === 404 || (e as { status?: number }).status === 403) this.missing.set(true);
    } finally {
      this.loaded.set(true);
    }
  }

  async vote() {
    const i = this.idea();
    if (!i) return;
    this.idea.set({ ...i, votedByMe: !i.votedByMe, voteCount: i.voteCount + (i.votedByMe ? -1 : 1) });
    this.idea.set(await this.api.toggleVote(this.session.tripId(), i.id));
  }

  async comment() {
    const i = this.idea();
    const body = this.commentDraft.trim();
    if (!i || !body) return;
    const c = await this.api.addComment(this.session.tripId(), i.id, body);
    this.comments.update((all) => [...all, c]);
    this.idea.set({ ...i, commentCount: i.commentCount + 1 });
    this.commentDraft = '';
  }

  async deleteComment(c: Comment) {
    const i = this.idea();
    if (!i) return;
    await this.api.deleteComment(this.session.tripId(), c.id);
    this.comments.update((all) => all.filter((x) => x.id !== c.id));
    this.idea.set({ ...i, commentCount: Math.max(0, i.commentCount - 1) });
  }

  canDeleteComment(c: Comment): boolean {
    const m = this.me();
    return !!m && (m.isOwner || c.member.id === m.id);
  }

  onEdited(idea: Idea) {
    this.idea.set(idea);
    this.editing.set(false);
    this.flash('Saved ✓');
  }

  async remove() {
    const i = this.idea();
    if (!i || !confirm(`Remove "${i.title}"?`)) return;
    await this.api.deleteIdea(this.session.tripId(), i.id);
    await this.router.navigate(this.backLink());
  }

  async shareIdea() {
    const i = this.idea();
    if (!i) return;
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
