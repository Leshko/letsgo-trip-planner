import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SessionService } from '../../core/session.service';
import { KnownTrip, MyTrip, TripKind } from '../../core/models';
import { dateRangeLabel, daysUntil, longDate } from '../../core/format';
import { AvatarStackComponent } from '../../shared/avatar-stack.component';
import { ApiService } from '../../core/api.service';
import { PushService } from '../../core/push.service';

@Component({
  selector: 'app-my-trips',
  imports: [RouterLink, AvatarStackComponent],
  template: `
    <div class="page">
      <div class="row mt" style="justify-content:space-between;align-items:center">
        <h1>My trips</h1>
        @if (account()) {
          <button class="btn btn--ghost btn--sm" type="button" (click)="menu.set(!menu())" data-testid="account-menu">{{ who() }}</button>
        } @else {
          <a class="btn btn--ghost btn--sm" routerLink="/signin" [queryParams]="{ next: '/trips' }" data-testid="trips-signin">Sign in</a>
        }
      </div>
      <p class="muted">Your trips and gatherings.</p>

      @if (menu()) {
        <div class="card mt stack-v" data-testid="account-card">
          <div><div class="label">Signed in as</div><div>{{ account()?.user?.email || account()?.user?.name }}</div>
            <div class="tiny">with {{ providers() }}</div></div>
          <button class="btn btn--sm" type="button" (click)="signOut()" data-testid="signout">Sign out</button>
          <button class="btn btn--ghost btn--danger btn--sm" type="button" (click)="deleteAccount()">Delete my account</button>
        </div>
      }

      @if (note()) { <p class="card card--flat mt" data-testid="trips-note">{{ note() }}</p> }

      <div class="stack-v mt" style="gap:12px">
        @for (t of trips(); track t.trip.id) {
          <button class="card trip-card" type="button" (click)="open(t)" [attr.data-testid]="'trip-' + t.trip.id">
            <div class="row" style="justify-content:space-between;gap:8px">
              <div style="text-align:left;min-width:0">
                <div class="trip-card__name">{{ t.trip.name }}</div>
                <div class="tiny">{{ t.trip.destination || 'Somewhere great' }} · {{ range(t) }}</div>
              </div>
              <span class="row" style="gap:4px;flex:0 0 auto">
                @if (t.trip.kind === 'gathering') { <span class="chip chip--sun">gathering</span> }
                @if (t.member.isOwner) { <span class="chip chip--sea">organizer</span> }
              </span>
            </div>
            <div class="row mt" style="justify-content:space-between">
              <span class="row tiny" style="gap:6px"><app-avatar-stack [members]="t.trip.members" [max]="5" /> {{ t.trip.members.length }} in</span>
              <span class="tiny">{{ when(t) }}</span>
            </div>
          </button>
        }
        <!-- Joined on this phone without an account (or not saved to it yet). -->
        @for (k of onThisPhone(); track k.id) {
          <button class="card trip-card" type="button" (click)="openKnown(k)" [attr.data-testid]="'known-' + k.id">
            <div class="row" style="justify-content:space-between;gap:8px">
              <div style="text-align:left;min-width:0">
                <div class="trip-card__name">{{ k.name }}</div>
                <div class="tiny">{{ k.destination || (k.kind === 'gathering' ? 'Together' : 'Somewhere great') }} · {{ rangeOf(k.startDate, k.endDate) }}</div>
              </div>
              <span class="row" style="gap:4px;flex:0 0 auto">
                @if (k.kind === 'gathering') { <span class="chip chip--sun">gathering</span> }
                <span class="chip">on this phone</span>
              </span>
            </div>
            <div class="row mt" style="justify-content:space-between">
              <span class="tiny">You're in as {{ k.memberName }}</span>
              <span class="tiny">{{ whenOf(k.startDate, k.endDate, k.kind) }}</span>
            </div>
          </button>
        }
        @if (!trips().length && !onThisPhone().length) {
          <div class="card card--flat empty"><div class="big">🧳</div>Nothing yet. Start a trip or a gathering, or join with a code from your family.</div>
        }
        @if (openError()) { <p class="error">{{ openError() }}</p> }
        @if (!account() && onThisPhone().length) {
          <p class="tiny" data-testid="phone-only-note">These are saved on this phone only. Sign in to keep them safe and open them on any device.</p>
        }
      </div>

      <div class="row mt-lg" style="gap:8px">
        <a class="btn btn--primary grow" routerLink="/" [queryParams]="{ create: 1 }" data-testid="new-trip">Start a trip</a>
        <a class="btn btn--primary grow" routerLink="/" [queryParams]="{ create: 1, kind: 'gathering' }" data-testid="new-gathering">Start a gathering</a>
      </div>
      <a class="btn btn--tinted btn--block mt" routerLink="/" [queryParams]="{ join: 1 }">Join with a code</a>
    </div>
  `,
})
export class MyTripsComponent {
  private readonly session = inject(SessionService);
  private readonly api = inject(ApiService);
  private readonly push = inject(PushService);
  private readonly router = inject(Router);

  readonly account = this.session.account;
  readonly menu = signal(false);
  readonly note = signal<string>((history.state as { note?: string } | null)?.note ?? '');
  readonly trips = computed(() => this.account()?.trips ?? []);
  /** Joined on this phone and not (yet) part of the signed-in account. */
  readonly onThisPhone = computed(() => {
    const mine = new Set(this.trips().map((t) => t.trip.id));
    return this.session.known().filter((k) => !mine.has(k.id));
  });
  readonly openError = signal('');
  readonly who = computed(() => {
    const u = this.account()?.user;
    return u?.name?.split(' ')[0] || u?.email?.split('@')[0] || 'Account';
  });
  readonly providers = computed(() => {
    const names = { google: 'Google', microsoft: 'Microsoft', email: 'email code' };
    const list = [...new Set((this.account()?.user.signIns ?? []).map((s) => names[s.provider]))];
    return list.join(', ') || 'email code';
  });

  constructor() {
    void this.session.restoreAccount(true);
  }

  range(t: MyTrip) {
    return this.rangeOf(t.trip.startDate, t.trip.endDate);
  }

  rangeOf(start: string, end: string) {
    return start === end ? longDate(start) : dateRangeLabel(start, end);
  }

  when(t: MyTrip) {
    return this.whenOf(t.trip.startDate, t.trip.endDate, t.trip.kind);
  }

  whenOf(startDate: string, endDate: string, kind?: TripKind) {
    const start = daysUntil(startDate);
    if (start > 1) return `in ${start} days`;
    if (start === 1) return 'tomorrow';
    if (daysUntil(endDate) >= 0) return startDate === endDate ? 'today' : 'happening now';
    return kind === 'gathering' ? 'past gathering' : 'past trip';
  }

  async openKnown(k: KnownTrip) {
    this.openError.set('');
    if (await this.session.switchTo(k)) {
      await this.router.navigateByUrl('/trip');
      return;
    }
    this.openError.set(
      this.session.unreachable()
        ? "Can't reach LetsGo Together right now. Try again in a moment."
        : `"${k.name}" isn't available on this phone anymore. Rejoin with its invite code.`,
    );
  }

  async open(t: MyTrip) {
    if (this.session.token() !== t.token) this.session.openTrip(t);
    await this.router.navigateByUrl('/trip');
  }

  async signOut() {
    await this.push.disable().catch(() => undefined);
    await this.session.signOutAccount();
    await this.router.navigateByUrl('/');
  }

  async deleteAccount() {
    if (!confirm('Delete your account? Your trips, gatherings, votes and photos stay. You just won\'t be able to sign in with this account anymore.')) return;
    await this.api.deleteAccount();
    await this.push.disable().catch(() => undefined);
    this.session.signOut();
    this.session.clearAccount();
    await this.router.navigateByUrl('/');
  }
}
