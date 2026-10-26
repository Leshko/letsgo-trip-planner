import { Component, computed, HostListener, inject, input, model, OnDestroy, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { Photo, PhotoComment } from '../../core/models';
import { formatBytes } from '../../core/image';
import { AvatarComponent } from '../../shared/avatar.component';
import { IconComponent } from '../../shared/icon.component';
import { AgoPipe } from '../../shared/pipes';

/** Full-screen photo viewer with swipe, caption editing, comments and download. */
@Component({
  selector: 'app-photo-viewer',
  imports: [FormsModule, AvatarComponent, IconComponent, AgoPipe],
  templateUrl: './photo-viewer.component.html',
})
export class PhotoViewerComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  readonly session = inject(SessionService);

  readonly photos = input.required<Photo[]>();
  readonly index = model<number | null>(0);
  readonly closed = output<void>();
  readonly deleted = output<Photo>();
  readonly updated = output<Photo>();

  readonly me = this.session.member;
  readonly current = computed(() => {
    const i = this.index();
    return i === null ? null : (this.photos()[i] ?? null);
  });
  readonly position = computed(() => `${(this.index() ?? 0) + 1} / ${this.photos().length}`);
  readonly canManage = computed(() => {
    const m = this.me();
    const p = this.current();
    return !!m && !!p && (m.isOwner || p.uploadedBy.id === m.id);
  });
  readonly sizeLabel = computed(() => (this.current() ? formatBytes(this.current()!.bytes) : ''));

  readonly showComments = signal(false);
  readonly comments = signal<PhotoComment[]>([]);
  readonly editingCaption = signal(false);
  commentDraft = '';
  captionDraft = '';
  private touchX: number | null = null;

  ngOnInit() {
    document.body.classList.add('viewer-open');
  }

  ngOnDestroy() {
    document.body.classList.remove('viewer-open');
  }

  @HostListener('document:keydown', ['$event'])
  onKey(ev: KeyboardEvent) {
    if (this.showComments() || this.editingCaption()) return;
    if (ev.key === 'Escape') this.closed.emit();
    if (ev.key === 'ArrowRight') this.step(1);
    if (ev.key === 'ArrowLeft') this.step(-1);
  }

  onTouchStart(ev: TouchEvent) {
    this.touchX = ev.touches[0]?.clientX ?? null;
  }

  onTouchEnd(ev: TouchEvent) {
    if (this.touchX === null) return;
    const dx = (ev.changedTouches[0]?.clientX ?? this.touchX) - this.touchX;
    this.touchX = null;
    if (Math.abs(dx) > 40) this.step(dx < 0 ? 1 : -1);
  }

  step(delta: number) {
    const n = this.photos().length;
    if (!n) return;
    const i = this.index() ?? 0;
    const next = Math.min(n - 1, Math.max(0, i + delta));
    if (next !== i) {
      this.index.set(next);
      this.showComments.set(false);
      this.editingCaption.set(false);
    }
  }

  async openComments() {
    const p = this.current();
    if (!p) return;
    this.showComments.set(true);
    this.comments.set([]);
    this.commentDraft = '';
    this.comments.set(await this.api.listPhotoComments(this.session.tripId(), p.id));
  }

  async addComment() {
    const p = this.current();
    const body = this.commentDraft.trim();
    if (!p || !body) return;
    const c = await this.api.addPhotoComment(this.session.tripId(), p.id, body);
    this.comments.update((all) => [...all, c]);
    this.commentDraft = '';
    this.updated.emit({ ...p, commentCount: p.commentCount + 1 });
  }

  async deleteComment(c: PhotoComment) {
    const p = this.current();
    if (!p) return;
    await this.api.deletePhotoComment(this.session.tripId(), c.id);
    this.comments.update((all) => all.filter((x) => x.id !== c.id));
    this.updated.emit({ ...p, commentCount: Math.max(0, p.commentCount - 1) });
  }

  canDeleteComment(c: PhotoComment): boolean {
    const m = this.me();
    return !!m && (m.isOwner || c.member.id === m.id);
  }

  startCaption() {
    this.captionDraft = this.current()?.caption ?? '';
    this.editingCaption.set(true);
  }

  async saveCaption() {
    const p = this.current();
    if (!p) return;
    const saved = await this.api.updatePhotoCaption(this.session.tripId(), p.id, this.captionDraft);
    this.updated.emit(saved);
    this.editingCaption.set(false);
  }

  async remove() {
    const p = this.current();
    if (!p || !confirm('Delete this photo for everyone?')) return;
    await this.api.deletePhoto(this.session.tripId(), p.id);
    this.deleted.emit(p);
  }
}
