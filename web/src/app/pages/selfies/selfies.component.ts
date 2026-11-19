import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { SelfieChallenge, SelfieDifficulty, SelfieEntry, SelfieGame, SelfieResult } from '../../core/models';
import { ordinal } from '../../core/format';
import { coverThumbnail, resizeToMax } from '../../core/image';
import { usePolling } from '../../core/polling';
import { AvatarComponent } from '../../shared/avatar.component';
import { AvatarStackComponent } from '../../shared/avatar-stack.component';
import { messageOf } from '../landing/landing.component';

interface Upload {
  challengeId: string;
  /** Sending the photo, then waiting for the judge. */
  stage: 'preparing' | 'uploading' | 'judging';
  pct: number;
}

/** The selfie game: a list of selfies to take on the trip, judged by the AI and scored. */
@Component({
  selector: 'app-selfies',
  imports: [FormsModule, RouterLink, AvatarComponent, AvatarStackComponent],
  templateUrl: './selfies.component.html',
})
export class SelfiesComponent {
  private readonly api = inject(ApiService);
  readonly session = inject(SessionService);

  readonly me = this.session.member;
  readonly game = signal<SelfieGame | null>(null);
  readonly upload = signal<Upload | null>(null);
  /** The verdict sheet after an upload. */
  readonly result = signal<(SelfieResult & { title: string }) | null>(null);
  /** Someone's selfie opened full size. */
  readonly viewing = signal<{ entry: SelfieEntry; title: string } | null>(null);
  readonly error = signal('');
  readonly toast = signal('');
  /** Organizer: which challenge is busy (replace / remove), and which is being edited. */
  readonly working = signal('');
  readonly editing = signal<SelfieChallenge | null>(null);
  readonly adding = signal(false);
  readonly managing = signal(false);
  formTitle = '';
  formHint = '';
  formDifficulty: SelfieDifficulty = 'easy';

  readonly ordinal = ordinal;
  readonly canPlay = computed(() => this.game()?.status === 'open');
  readonly anyEntries = computed(() => !!this.game()?.challenges.some((c) => c.done.length || c.rejected.length || c.myRejected));
  readonly summary = computed(() => {
    const g = this.game();
    if (!g) return '';
    const place = g.me.rank ? ` · ${ordinal(g.me.rank)} place` : '';
    return `${g.me.done} of ${g.total} done · ${g.me.points} points${place}`;
  });

  constructor() {
    // Quick while the list is being written, relaxed otherwise.
    usePolling(() => this.load(), 10_000);
  }

  async load() {
    const id = this.session.tripId();
    // Don't swap the list under an open sheet or a running upload.
    if (!id || this.upload() || this.editing() || this.adding()) return;
    try {
      const g = await this.api.selfieGame(id);
      this.game.set(g);
      if (g.status === 'preparing') setTimeout(() => void this.load(), 3000);
    } catch {
      /* keep what's showing; the next poll retries */
    }
  }

  doneBy(c: SelfieChallenge) {
    return c.done.map((e) => e.member);
  }

  uploadingFor(c: SelfieChallenge): Upload | null {
    const u = this.upload();
    return u && u.challengeId === c.id ? u : null;
  }

  /** A picked or freshly taken photo: shrink copies on the phone, upload, wait for the judge. */
  async onPicked(c: SelfieChallenge, ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.upload()) return;
    this.error.set('');
    this.upload.set({ challengeId: c.id, stage: 'preparing', pct: 0 });

    const form = new FormData();
    form.append('batchId', crypto.randomUUID());
    form.append('original', file, file.name);
    try {
      const [thumb, preview] = await Promise.all([coverThumbnail(file, 400), resizeToMax(file, 1600, 0.85)]);
      form.append('thumb', thumb, 'thumb.jpg');
      form.append('preview', preview.blob, 'preview.jpg');
      form.append('width', String(preview.sourceWidth));
      form.append('height', String(preview.sourceHeight));
    } catch {
      // The browser can't decode it (HEIC on some phones): send the original alone.
    }

    this.upload.set({ challengeId: c.id, stage: 'uploading', pct: 0 });
    this.api.submitSelfie(this.session.tripId(), c.id, form).subscribe({
      next: (e) => {
        if (e.type === HttpEventType.UploadProgress && e.total) {
          const pct = Math.round((100 * e.loaded) / e.total);
          this.upload.set({ challengeId: c.id, stage: pct >= 100 ? 'judging' : 'uploading', pct });
        }
        if (e.type === HttpEventType.Response && e.body) {
          this.game.set(e.body.game);
          this.result.set({ ...e.body, title: c.title });
        }
      },
      error: (err: HttpErrorResponse) => {
        this.upload.set(null);
        this.error.set(err.status === 413 ? 'That photo is too big (25 MB max).' : messageOf(err, "Couldn't upload that selfie. Try again."));
      },
      complete: () => this.upload.set(null),
    });
  }

  // ---------- organizer ----------

  private async run(key: string, fn: () => Promise<SelfieGame>, done?: string) {
    this.error.set('');
    this.working.set(key);
    try {
      this.game.set(await fn());
      if (done) this.flash(done);
    } catch (e: unknown) {
      this.error.set(messageOf(e, "That didn't work. Try again."));
    } finally {
      this.working.set('');
    }
  }

  /** Swap one challenge for a fresh AI idea of the same difficulty. */
  replace(c: SelfieChallenge) {
    const scored = c.done.length;
    const msg = scored
      ? `Replace "${c.title}" with a new idea? ${scored === 1 ? '1 person has' : scored + ' people have'} already done it; they keep their points.`
      : `Replace "${c.title}" with a new idea?`;
    if (!confirm(msg)) return;
    void this.run(c.id, () => this.api.selfieReplace(this.session.tripId(), c.id), 'Swapped for a new one');
  }

  remove(c: SelfieChallenge) {
    const msg = c.done.length ? `Remove "${c.title}"? People who already did it keep their points.` : `Remove "${c.title}"?`;
    if (!confirm(msg)) return;
    void this.run(c.id, () => this.api.selfieRemove(this.session.tripId(), c.id));
  }

  startEdit(c: SelfieChallenge) {
    this.adding.set(false);
    this.formTitle = c.title;
    this.formHint = c.hint;
    this.formDifficulty = c.difficulty;
    this.editing.set(c);
  }

  startAdd() {
    this.editing.set(null);
    this.formTitle = 'Selfie with ';
    this.formHint = '';
    this.formDifficulty = 'easy';
    this.adding.set(true);
  }

  cancelForm() {
    this.editing.set(null);
    this.adding.set(false);
  }

  async saveForm() {
    const body = { title: this.formTitle.trim(), hint: this.formHint.trim(), difficulty: this.formDifficulty };
    const editing = this.editing();
    const id = this.session.tripId();
    this.error.set('');
    try {
      this.game.set(editing ? await this.api.selfieEdit(id, editing.id, body) : await this.api.selfieAdd(id, body));
      this.cancelForm();
    } catch (e: unknown) {
      this.error.set(messageOf(e, "Couldn't save that challenge"));
    }
  }

  newList() {
    if (!confirm('Have the AI write a whole new list? The current challenges are thrown away.')) return;
    void this.run('list', () => this.api.selfieRegenerate(this.session.tripId()), 'New list ready');
  }

  setOn(on: boolean) {
    if (!on && !confirm('Turn the selfie game off for this trip? Scores are kept if you turn it back on.')) return;
    void this.run('state', () => this.api.selfieSetOn(this.session.tripId(), on));
  }

  /** The organizer's word is final. */
  overrule(e: SelfieEntry, status: 'approved' | 'rejected') {
    if (status === 'rejected' && !confirm(`Take ${e.member.name}'s selfie off the board? They lose its points.`)) return;
    this.viewing.set(null);
    void this.run(e.challengeId, () => this.api.selfieOverrule(this.session.tripId(), e.id, status), status === 'approved' ? 'Counted!' : 'Taken off the board');
  }

  flash(msg: string) {
    this.toast.set(msg);
    setTimeout(() => this.toast.set(''), 1800);
  }
}
