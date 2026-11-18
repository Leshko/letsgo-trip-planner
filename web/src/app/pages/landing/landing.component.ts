import { TripKind } from '../../core/models';
import { Component, computed, inject, input, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SignInPanelComponent } from '../account/signin-panel.component';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { addDays, todayIso } from '../../core/format';
import { EmojiPickerComponent } from '../../shared/emoji-picker.component';

type Mode = 'join' | 'create' | 'code';

@Component({
  selector: 'app-landing',
  imports: [FormsModule, EmojiPickerComponent, SignInPanelComponent, RouterLink],
  templateUrl: './landing.component.html',
})
export class LandingComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  readonly session = inject(SessionService);
  private readonly router = inject(Router);

  /** Bound from /join/:code by the router. */
  readonly code = input<string>();
  /** Where to go after signing in (share links and notifications). Only in-app paths are honoured. */
  readonly next = input<string>();
  /** ?create=1 / ?join=1 from My trips. */
  readonly createParam = input<string | undefined>(undefined, { alias: 'create' });
  readonly joinParam = input<string | undefined>(undefined, { alias: 'join' });
  /** ?kind=gathering from My trips. */
  readonly kindParam = input<string | undefined>(undefined, { alias: 'kind' });
  /** What's being started: a trip, or a simpler gathering. */
  readonly kind = signal<TripKind>('trip');
  /** A gathering is one day unless they say otherwise. */
  moreDays = false;
  readonly hasAccount = this.session.hasAccount;
  /** No sign-in method set up on this server yet: trips start the old way. */
  readonly noSignIn = signal(false);
  readonly mode = signal<Mode>('join');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly fromLink = computed(() => !!this.code());
  readonly unreachable = this.session.unreachable;
  readonly retrying = signal(false);
  /** While the server is unreachable, quietly try again every few seconds. */
  private readonly autoRetry = setInterval(() => {
    if (this.unreachable() && !this.retrying()) void this.retry();
  }, 5000);

  ngOnDestroy() {
    clearInterval(this.autoRetry);
  }

  /** The server was unreachable when the app opened; the trip is still saved here. */
  async retry() {
    this.retrying.set(true);
    try {
      if (await this.session.restore(true)) await this.router.navigateByUrl(this.target());
    } finally {
      this.retrying.set(false);
    }
  }

  // join form
  joinCode = '';
  joinName = '';
  joinEmoji = '';

  // login code from another device
  loginCode = '';

  // create form
  tripName = '';
  destination = '';
  startDate = addDays(todayIso(), 30);
  endDate = addDays(todayIso(), 34);
  memberName = '';
  createEmoji = '';

  constructor() {
    void this.arrive();
    void this.session.restoreAccount().then(() => this.prefillName());
    this.api
      .signInOptions()
      .then((o) => this.noSignIn.set(!o.google && !o.microsoft && !o.email))
      .catch(() => undefined);
  }

  private target(): string {
    return safeNext(this.next());
  }

  /**
   * Arriving here with something already on this phone. An invite link or QR
   * code for a trip this phone (or account) is already in opens that trip;
   * for one it isn't in yet, the join form stays, even if another trip is open.
   */
  private async arrive() {
    const signedIn = await this.session.restore();
    if (this.createParam() || this.joinParam()) return;
    const code = this.code();
    if (!code) {
      if (signedIn) await this.router.navigateByUrl(this.target());
      return;
    }
    if ((await this.session.openByCode(code)) === 'open') await this.router.navigateByUrl(this.target());
  }

  ngOnInit() {
    const c = this.code();
    if (c) {
      this.joinCode = c.toUpperCase();
      this.mode.set('join');
    } else if (this.createParam()) {
      this.mode.set('create');
    }
    if (this.kindParam() === 'gathering') this.setKind('gathering');
  }

  /** Signed in: start from the account's first name. */
  prefillName() {
    const first = this.session.account()?.user.name.split(' ')[0] ?? '';
    if (first && !this.memberName) this.memberName = first;
    if (first && !this.joinName) this.joinName = first;
  }

  signedInToCreate() {
    this.prefillName();
    this.mode.set('create');
  }

  setKind(kind: TripKind) {
    this.kind.set(kind);
    // A gathering is usually soon and one day; a trip defaults to a month out.
    if (kind === 'gathering') {
      this.startDate = addDays(todayIso(), 14);
      this.endDate = this.startDate;
      this.moreDays = false;
    } else {
      this.startDate = addDays(todayIso(), 30);
      this.endDate = addDays(todayIso(), 34);
    }
  }

  async join() {
    this.error.set('');
    this.busy.set(true);
    try {
      const s = await this.api.joinTrip({ code: this.joinCode, name: this.joinName, emoji: this.joinEmoji });
      this.session.start(s);
      await this.router.navigateByUrl(this.target());
    } catch (e: unknown) {
      this.error.set(messageOf(e, "Couldn't find a trip with that code"));
    } finally {
      this.busy.set(false);
    }
  }

  async redeem() {
    this.error.set('');
    this.busy.set(true);
    try {
      const s = await this.api.redeemTransferCode(this.loginCode);
      this.session.start(s);
      await this.router.navigateByUrl(this.target());
    } catch (e: unknown) {
      this.error.set(messageOf(e, "That code didn't work"));
    } finally {
      this.busy.set(false);
    }
  }

  async create() {
    this.error.set('');
    this.busy.set(true);
    try {
      const gathering = this.kind() === 'gathering';
      const s = await this.api.createTrip({
        kind: this.kind(),
        name: this.tripName,
        destination: this.destination,
        startDate: this.startDate,
        endDate: gathering && !this.moreDays ? this.startDate : this.endDate,
        memberName: this.memberName,
        emoji: this.createEmoji,
      });
      this.session.start(s);
      await this.router.navigateByUrl(this.target());
    } catch (e: unknown) {
      this.error.set(messageOf(e, this.kind() === 'gathering' ? "Couldn't create the gathering" : "Couldn't create the trip"));
    } finally {
      this.busy.set(false);
    }
  }
}

export function messageOf(e: unknown, fallback: string): string {
  const err = e as { error?: { message?: string | string[] } };
  const m = err?.error?.message;
  if (Array.isArray(m)) return m[0] ?? fallback;
  return typeof m === 'string' ? m : fallback;
}

/** Share links and notifications may ask for a page after sign-in; only in-app /trip paths are allowed. */
export function safeNext(n: string | undefined): string {
  if (!n) return '/trip';
  if (!/^\/trip(\/|\?|#|$)/.test(n) || n.startsWith('//')) return '/trip';
  return n;
}
