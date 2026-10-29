import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SessionService } from '../../core/session.service';
import { MyTrip } from '../../core/models';
import { dateRangeLabel, daysUntil } from '../../core/format';
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
        <button class="btn btn--ghost btn--sm" type="button" (click)="menu.set(!menu())" data-testid="account-menu">{{ who() }}</button>
      </div>

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
              @if (t.member.isOwner) { <span class="chip chip--sea">organizer</span> }
            </div>
            <div class="row mt" style="justify-content:space-between">
              <span class="row tiny" style="gap:6px"><app-avatar-stack [members]="t.trip.members" [max]="5" /> {{ t.trip.members.length }} in</span>
              <span class="tiny">{{ when(t) }}</span>
            </div>
          </button>
        } @empty {
          <div class="card card--flat empty"><div class="big">🧳</div>No trips yet. Start one, or join with a code from your family.</div>
        }
      </div>

      <div class="row mt-lg" style="gap:8px">
        <a class="btn btn--primary grow" routerLink="/" [queryParams]="{ create: 1 }" data-testid="new-trip">Start a new trip</a>
        <a class="btn btn--tinted grow" routerLink="/" [queryParams]="{ join: 1 }">Join with a code</a>
      </div>
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
    return dateRangeLabel(t.trip.startDate, t.trip.endDate);
  }

  when(t: MyTrip) {
    const start = daysUntil(t.trip.startDate);
    if (start > 1) return `in ${start} days`;
    if (start === 1) return 'tomorrow';
    return daysUntil(t.trip.endDate) >= 0 ? 'happening now' : 'past trip';
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
    if (!confirm('Delete your account? Your trips, votes and photos stay. You just won\'t be able to sign in with this account anymore.')) return;
    await this.api.deleteAccount();
    await this.push.disable().catch(() => undefined);
    this.session.signOut();
    this.session.clearAccount();
    await this.router.navigateByUrl('/');
  }
}
