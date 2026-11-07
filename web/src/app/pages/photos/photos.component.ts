import { absUrl, isNativeApp } from '../../core/platform';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ShareService } from '../../core/share.service';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { Photo } from '../../core/models';
import { coverThumbnail, formatBytes, resizeToMax } from '../../core/image';
import { usePolling } from '../../core/polling';
import { IconComponent } from '../../shared/icon.component';
import { PhotoViewerComponent } from './photo-viewer.component';

interface UploadItem {
  name: string;
  status: 'resizing' | 'uploading' | 'done' | 'error';
  pct: number;
  error?: string;
}

@Component({
  selector: 'app-photos',
  imports: [IconComponent, PhotoViewerComponent],
  templateUrl: './photos.component.html',
})
export class PhotosComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly session = inject(SessionService);
  readonly share = inject(ShareService);

  /** ?photo=<id> from a share link or notification opens that photo. */
  readonly photo = input<string>();
  private openedFromLink = false;
  readonly toast = signal('');

  readonly photos = signal<Photo[]>([]);
  readonly loaded = signal(false);
  readonly uploads = signal<UploadItem[]>([]);
  readonly viewing = signal<number | null>(null);
  readonly totalBytes = computed(() => this.photos().reduce((n, p) => n + p.bytes, 0));
  readonly totalLabel = computed(() => formatBytes(this.totalBytes()));
  readonly native = isNativeApp();
  readonly zipUrl = computed(() => absUrl(`/api/trips/${this.session.tripId()}/photos.zip?token=${encodeURIComponent(this.session.token() ?? '')}`));
  readonly busyCount = computed(() => this.uploads().filter((u) => u.status === 'resizing' || u.status === 'uploading').length);

  constructor() {
    usePolling(() => this.load(), 15_000);
  }

  async load() {
    const id = this.session.tripId();
    if (!id) return;
    const fresh = await this.api.listPhotos(id);
    // Keep the viewer stable while polling.
    this.photos.set(fresh);
    this.loaded.set(true);
    const target = this.photo();
    if (target && !this.openedFromLink) {
      this.openedFromLink = true;
      const idx = fresh.findIndex((p) => p.id === target);
      if (idx >= 0) this.viewing.set(idx);
      void this.router.navigate([], { queryParams: { photo: null }, replaceUrl: true });
    }
  }

  /** One batch per picker selection. Files go one at a time so phones don't run out of memory. */
  async onPicked(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    const batchId = crypto.randomUUID();
    for (const file of files) await this.uploadOne(file, batchId);
  }

  private async uploadOne(file: File, batchId: string) {
    const item: UploadItem = { name: file.name, status: 'resizing', pct: 0 };
    this.uploads.update((all) => [...all, item]);
    const patch = (p: Partial<UploadItem>) => this.uploads.update((all) => all.map((u) => (u === item ? Object.assign(u, p) : u)));

    const form = new FormData();
    form.append('batchId', batchId);
    form.append('original', file, file.name);
    try {
      const [thumb, preview] = await Promise.all([coverThumbnail(file, 400), resizeToMax(file, 1600, 0.85)]);
      form.append('thumb', thumb, 'thumb.jpg');
      form.append('preview', preview.blob, 'preview.jpg');
      form.append('width', String(preview.sourceWidth));
      form.append('height', String(preview.sourceHeight));
    } catch {
      // Browser can't decode it (HEIC on some platforms): keep the original, skip previews.
    }

    patch({ status: 'uploading' });
    await new Promise<void>((resolve) => {
      this.api.uploadPhoto(this.session.tripId(), form).subscribe({
        next: (e) => {
          if (e.type === HttpEventType.UploadProgress && e.total) patch({ pct: Math.round((100 * e.loaded) / e.total) });
          if (e.type === HttpEventType.Response && e.body) {
            const photo = e.body;
            this.photos.update((all) => [photo, ...all.filter((p) => p.id !== photo.id)]);
            patch({ status: 'done', pct: 100 });
          }
        },
        error: (err: HttpErrorResponse) => {
          const msg =
            err.status === 413
              ? 'Too big (25 MB max)'
              : (err.error as { message?: string | string[] })?.message?.toString() || "Couldn't upload";
          patch({ status: 'error', error: msg });
          resolve();
        },
        complete: () => {
          setTimeout(() => this.uploads.update((all) => all.filter((u) => u !== item)), 2500);
          resolve();
        },
      });
    });
  }

  dismissUpload(u: UploadItem) {
    this.uploads.update((all) => all.filter((x) => x !== u));
  }

  onDeleted(photo: Photo) {
    this.photos.update((all) => all.filter((p) => p.id !== photo.id));
    const i = this.viewing();
    if (i !== null) this.viewing.set(this.photos().length ? Math.min(i, this.photos().length - 1) : null);
  }

  async sharePhoto(p: Photo) {
    const out = await this.share.share({ title: this.session.trip()?.name ?? 'LetsGo Together', text: p.caption || 'Trip photo', path: `/trip/photos?photo=${p.id}` });
    if (out === 'copied') this.flash('Link copied');
    else if (out === 'failed') this.flash("Couldn't share");
  }

  flash(msg: string) {
    this.toast.set(msg);
    setTimeout(() => this.toast.set(''), 1800);
  }

  onUpdated(photo: Photo) {
    this.photos.update((all) => all.map((p) => (p.id === photo.id ? photo : p)));
  }
}
