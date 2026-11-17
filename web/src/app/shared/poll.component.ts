import { Component, computed, inject, input, output, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { SessionService } from '../core/session.service';
import { ShareService } from '../core/share.service';
import { Member, PollOption, Post } from '../core/models';
import { messageOf } from '../pages/landing/landing.component';
import { AvatarStackComponent } from './avatar-stack.component';
import { IconComponent } from './icon.component';

/** A poll on a wall post: tap an option to vote, see who picked what, share a link to it. */
@Component({
  selector: 'app-poll',
  imports: [AvatarStackComponent, IconComponent],
  template: `
    @if (post().poll; as poll) {
      <div class="poll" [class.poll--closed]="poll.closed" data-testid="poll">
        <div class="poll__hint tiny">
          📊 Poll · {{ poll.closed ? 'Voting is closed' : poll.multiple ? 'Pick as many as you like' : 'Pick one' }}
        </div>
        @for (o of poll.options; track o.id) {
          <button type="button" class="poll__opt" [class.is-mine]="o.mine" [class.is-top]="isTop(o)" [disabled]="poll.closed || busy()"
            (click)="vote(o)" [attr.aria-pressed]="o.mine" [attr.data-option]="o.text">
            <span class="poll__bar" [style.width.%]="pct(o)"></span>
            <span class="poll__mark" [class.poll__mark--square]="poll.multiple" aria-hidden="true">{{ o.mine ? '✓' : '' }}</span>
            <span class="poll__text">{{ o.text }}</span>
            @if (o.count) { <app-avatar-stack [members]="voters(o)" [max]="4" /> }
            <span class="poll__count">{{ o.count }}</span>
          </button>
        }
        @if (error()) { <p class="error tiny">{{ error() }}</p> }
        <div class="poll__foot">
          <span class="tiny" data-testid="poll-total">{{ totalLabel() }}</span>
          <span class="row" style="gap:6px">
            @if (canManage()) {
              <button type="button" class="btn btn--ghost btn--sm" (click)="setClosed(!poll.closed)" [disabled]="busy()" data-testid="poll-close">
                {{ poll.closed ? 'Reopen' : 'Close voting' }}
              </button>
            }
            <button type="button" class="btn btn--tinted btn--sm" (click)="share()" data-testid="poll-share"><app-icon name="share" [size]="16" /> Share</button>
          </span>
        </div>
        @if (toast()) { <div class="toast" role="status">{{ toast() }}</div> }
      </div>
    }
  `,
})
export class PollComponent {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly sharer = inject(ShareService);

  readonly post = input.required<Post>();
  /** The post after a vote or a close, so the page can swap it in. */
  readonly changed = output<Post>();
  readonly busy = signal(false);
  readonly error = signal('');
  readonly toast = signal('');

  readonly canManage = computed(() => {
    const me = this.session.member();
    return !!me && (me.isOwner || this.post().member.id === me.id);
  });

  readonly totalLabel = computed(() => {
    const n = this.post().poll?.voters ?? 0;
    const of = this.session.trip()?.members.length ?? 0;
    if (!n) return 'No votes yet';
    return `${n} of ${Math.max(of, n)} ${of === 1 ? 'person' : 'people'} voted`;
  });

  private readonly most = computed(() => Math.max(0, ...(this.post().poll?.options.map((o) => o.count) ?? [])));

  /** Share of the people who voted that picked this option. */
  pct(o: PollOption): number {
    const voters = this.post().poll?.voters ?? 0;
    return voters ? Math.round((o.count / voters) * 100) : 0;
  }

  isTop(o: PollOption): boolean {
    return o.count > 0 && o.count === this.most();
  }

  voters(o: PollOption): Member[] {
    const members = this.session.trip()?.members ?? [];
    return o.memberIds.map((id) => members.find((m) => m.id === id)).filter((m): m is Member => !!m);
  }

  async vote(o: PollOption) {
    this.error.set('');
    this.busy.set(true);
    try {
      this.changed.emit(await this.api.votePoll(this.session.tripId(), this.post().id, o.id));
    } catch (e: unknown) {
      this.error.set(messageOf(e, "Couldn't save your vote. Try again."));
    } finally {
      this.busy.set(false);
    }
  }

  async setClosed(closed: boolean) {
    this.error.set('');
    this.busy.set(true);
    try {
      this.changed.emit(await this.api.setPollClosed(this.session.tripId(), this.post().id, closed));
    } catch (e: unknown) {
      this.error.set(messageOf(e, "Couldn't change the poll"));
    } finally {
      this.busy.set(false);
    }
  }

  /** A link that opens straight to this poll (people not in the trip yet join first). */
  async share() {
    const p = this.post();
    const trip = this.session.trip()?.name ?? 'LetsGo Together';
    const out = await this.sharer.share({ title: p.body, text: `Vote: ${p.body} · ${trip}`, path: `/trip/poll/${p.id}` });
    if (out === 'copied') this.flash('Link copied');
    else if (out === 'failed') this.flash("Couldn't share");
  }

  private flash(msg: string) {
    this.toast.set(msg);
    setTimeout(() => this.toast.set(''), 1800);
  }
}
