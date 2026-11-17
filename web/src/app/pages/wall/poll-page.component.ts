import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { Post } from '../../core/models';
import { usePolling } from '../../core/polling';
import { AvatarComponent } from '../../shared/avatar.component';
import { PollComponent } from '../../shared/poll.component';
import { AgoPipe } from '../../shared/pipes';

/** One poll on its own page: where shared links and poll notifications land. */
@Component({
  selector: 'app-poll-page',
  imports: [RouterLink, AvatarComponent, PollComponent, AgoPipe],
  template: `
    <div class="page" data-testid="poll-page">
      <a routerLink="/trip/wall" class="btn btn--ghost btn--sm" style="margin-left:-10px">‹ The wall</a>
      @if (post(); as p) {
        <article class="card post mt">
          <app-avatar [member]="p.member" />
          <div class="post__bubble">
            <span class="comment__who">{{ p.member.id === me()?.id ? 'You' : p.member.name }}</span><span class="tiny">{{ p.createdAt | ago }}</span>
            <h2 class="poll__question" data-testid="poll-question">{{ p.body }}</h2>
            @if (p.poll) { <app-poll [post]="p" (changed)="post.set($event)" /> }
            @else { <p class="muted tiny mt">This is a post on the wall.</p> }
          </div>
        </article>
      } @else if (gone()) {
        <div class="card card--flat empty mt" data-testid="poll-gone">
          <div class="big">📊</div>
          This poll isn't here anymore.
          <div class="mt"><a class="btn btn--tinted btn--sm" routerLink="/trip/wall">Go to the wall</a></div>
        </div>
      }
    </div>
  `,
})
export class PollPageComponent {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);

  /** Bound from /trip/poll/:id by the router. */
  readonly id = input<string>('');
  readonly me = this.session.member;
  readonly post = signal<Post | null>(null);
  readonly gone = signal(false);
  private shown = '';

  constructor() {
    usePolling(() => this.load(), 8_000);
    // The link's poll (and any other poll link opened while this page shows).
    effect(() => {
      this.id();
      untracked(() => void this.load());
    });
  }

  async load() {
    const tripId = this.session.tripId();
    const id = this.id();
    if (!tripId || !id) return;
    if (id !== this.shown) {
      this.shown = id;
      this.post.set(null);
      this.gone.set(false);
    }
    if (this.gone()) return;
    try {
      const p = await this.api.getPost(tripId, id);
      if (id === this.id()) this.post.set(p);
    } catch (e) {
      // Deleted, or a link from another trip: say so. Anything else (offline) keeps what's showing.
      if (id === this.id() && e instanceof HttpErrorResponse && [400, 403, 404].includes(e.status)) {
        this.post.set(null);
        this.gone.set(true);
      }
    }
  }
}
