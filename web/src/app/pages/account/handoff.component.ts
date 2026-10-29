import { Component, inject, input, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { markMoved } from '../../shared/tour.component';
import { safeAppPath } from './signin-panel.component';

/** Arriving from the old web address with one-time codes for this phone's trip and/or account. */
@Component({
  selector: 'app-handoff',
  imports: [RouterLink],
  template: `
    <div class="page landing">
      <div class="hero"><p class="chip chip--accent">🌴 LetsGo Together</p></div>
      @if (problem()) {
        <div class="card mt stack-v" data-testid="handoff-problem">
          <h2>Almost there</h2>
          <p class="muted">{{ problem() }}</p>
          <a class="btn btn--primary btn--block" routerLink="/">Open LetsGo Together</a>
        </div>
      } @else {
        <p class="muted mt" data-testid="handoff-busy">Bringing your trip over…</p>
      }
    </div>
  `,
})
export class HandoffComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  readonly trip = input<string>();
  readonly account = input<string>();
  readonly next = input<string>();
  readonly problem = signal('');

  async ngOnInit() {
    let movedTrip = false;
    let movedAccount = false;
    const trip = this.trip();
    const account = this.account();
    if (trip) {
      try {
        this.session.start(await this.api.redeemTransferCode(trip));
        movedTrip = true;
      } catch {
        /* reported below */
      }
    }
    if (account) {
      try {
        await this.session.startAccount(await this.api.exchangeSignIn(account));
        movedAccount = true;
      } catch {
        /* reported below */
      }
    }
    if ((trip && !movedTrip) || (account && !movedAccount)) {
      this.problem.set(
        movedTrip || movedAccount
          ? "Part of your sign-in didn't come along. Open your family's invite link, or sign in again."
          : "Your sign-in didn't come along this time. Open your family's invite link again and type the same name as before, or sign in.",
      );
      if (movedTrip || movedAccount) markMoved();
      return;
    }
    if (movedTrip || movedAccount) markMoved();
    const fallback = movedTrip ? '/trip' : movedAccount ? '/trips' : '/';
    await this.router.navigateByUrl(safeAppPath(this.next(), fallback), { replaceUrl: true });
  }
}
