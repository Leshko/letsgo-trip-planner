import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { Post } from '../../core/models';
import { usePolling } from '../../core/polling';
import { AvatarComponent } from '../../shared/avatar.component';
import { AgoPipe } from '../../shared/pipes';

@Component({
  selector: 'app-wall',
  imports: [FormsModule, AvatarComponent, AgoPipe],
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

  constructor() {
    usePolling(() => this.load(), 8_000);
  }

  async load() {
    const id = this.session.tripId();
    if (!id) return;
    this.posts.set(await this.api.listPosts(id));
    this.loaded.set(true);
  }

  async post() {
    const body = this.draft.trim();
    if (!body) return;
    this.busy.set(true);
    try {
      const p = await this.api.createPost(this.session.tripId(), body);
      this.posts.update((all) => [p, ...all]);
      this.draft = '';
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
    if (!confirm('Delete this post?')) return;
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
