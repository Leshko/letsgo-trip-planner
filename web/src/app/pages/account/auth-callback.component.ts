import { Component, inject, input, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { messageOf } from '../landing/landing.component';
import { safeAppPath } from './signin-panel.component';

/** Lands here after Google/Microsoft (?code=) or from the emailed link (?t=). */
@Component({
  selector: 'app-auth-callback',
  imports: [RouterLink],
  template: `
    <div class="page landing">
      <div class="hero"><p class="chip chip--accent">🌴 LetsGo Together</p></div>
      @if (error()) {
        <div class="card mt stack-v">
          <h2>Couldn't sign you in</h2>
          <p class="error" data-testid="callback-error">{{ error() }}</p>
          <a class="btn btn--primary btn--block" routerLink="/signin">Try again</a>
        </div>
      } @else {
        <p class="muted mt" data-testid="callback-busy">Signing you in…</p>
      }
    </div>
  `,
})
export class AuthCallbackComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  readonly code = input<string>();
  readonly t = input<string>();
  readonly next = input<string>();
  readonly error = signal('');

  async ngOnInit() {
    try {
      const s = this.t() ? await this.api.emailVerify({ token: this.t()! }) : await this.api.exchangeSignIn(this.code() ?? '');
      const note = await this.session.startAccount(s);
      const fallback = this.session.token() ? '/trip' : '/trips';
      await this.router.navigateByUrl(safeAppPath(this.next(), fallback), { replaceUrl: true, state: note ? { note } : {} });
    } catch (e: unknown) {
      this.error.set(messageOf(e, 'That sign-in link expired. Please try again.'));
    }
  }
}
