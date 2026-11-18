import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { Post } from '../../core/models';
import { usePolling } from '../../core/polling';
import { AvatarComponent } from '../../shared/avatar.component';
import { AgoPipe } from '../../shared/pipes';
import { PollComponent } from '../../shared/poll.component';
import { messageOf } from '../landing/landing.component';

const MAX_OPTIONS = 10;

@Component({
  selector: 'app-wall',
  imports: [FormsModule, AvatarComponent, AgoPipe, PollComponent],
  templateUrl: './wall.component.html',
})
export class WallComponent {
  private readonly api = inject(ApiService);
  readonly session = inject(SessionService);

  readonly me = this.session.member;
  readonly posts = signal<Post[]>([]);
  readonly loaded = signal(false);
  readonly pickerFor = signal<string | null>(null);
  readonly quick = ['👍', '❤️', '😂', '🎉', '🙋', '🤔', '😋', '🔥'];
  draft = '';
  readonly busy = signal(false);
  readonly error = signal('');

  // poll composer
  readonly pollMode = signal(false);
  /** One text box per option; at least two. */
  readonly options = signal<string[]>(['', '']);
  pollMultiple = false;
  readonly maxOptions = MAX_OPTIONS;

  /** What would be sent: trimmed, blanks and repeats dropped. */
  private cleanOptions(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of this.options()) {
      const t = raw.trim();
      if (!t || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      out.push(t);
    }
    return out;
  }

  canPost(): boolean {
    if (this.busy() || !this.draft.trim()) return false;
    return !this.pollMode() || this.cleanOptions().length >= 2;
  }

  togglePoll() {
    this.error.set('');
    this.pollMode.update((on) => !on);
  }

  setOption(i: number, value: string) {
    this.options.update((all) => all.map((o, idx) => (idx === i ? value : o)));
  }

  addOption() {
    if (this.options().length < MAX_OPTIONS) this.options.update((all) => [...all, '']);
  }

  removeOption(i: number) {
    if (this.options().length > 2) this.options.update((all) => all.filter((_, idx) => idx !== i));
  }

  replace(updated: Post) {
    this.posts.update((all) => all.map((p) => (p.id === updated.id ? updated : p)));
  }

  /** ?poll=1 (from "Start a poll" buttons) opens the composer in poll mode. */
  readonly poll = input<string>();

  constructor() {
    usePolling(() => this.load(), 8_000);
    effect(() => {
      if (this.poll() === '1') untracked(() => this.pollMode.set(true));
    });
  }

  async load() {
    const id = this.session.tripId();
    if (!id) return;
    this.posts.set(await this.api.listPosts(id));
    this.loaded.set(true);
  }

  async post() {
    const body = this.draft.trim();
    if (!body || !this.canPost()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const poll = this.pollMode() ? { options: this.cleanOptions(), multiple: this.pollMultiple } : undefined;
      const p = await this.api.createPost(this.session.tripId(), body, poll);
      this.posts.update((all) => [p, ...all]);
      this.draft = '';
      this.pollMode.set(false);
      this.options.set(['', '']);
      this.pollMultiple = false;
    } catch (e: unknown) {
      this.error.set(messageOf(e, "Couldn't post that. Try again."));
    } finally {
      this.busy.set(false);
    }
  }

  async react(post: Post, emoji: string) {
    this.pickerFor.set(null);
    const updated = await this.api.react(this.session.tripId(), post.id, emoji);
    this.posts.update((all) => all.map((p) => (p.id === updated.id ? updated : p)));
  }

  canDelete(p: Post): boolean {
    const m = this.me();
    return !!m && (m.isOwner || p.member.id === m.id);
  }

  async remove(p: Post) {
    if (!confirm(p.poll ? 'Delete this poll and its votes?' : 'Delete this post?')) return;
    await this.api.deletePost(this.session.tripId(), p.id);
    this.posts.update((all) => all.filter((x) => x.id !== p.id));
  }

  whoReacted(post: Post, memberIds: string[]): string {
    const members = this.session.trip()?.members ?? [];
    return memberIds.map((id) => members.find((m) => m.id === id)?.name ?? 'someone').join(', ');
  }

  onKey(ev: KeyboardEvent) {
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      void this.post();
    }
  }
}
