import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { SignInOptions } from '../../core/models';
import { messageOf } from '../landing/landing.component';

/**
 * Google, Microsoft, or a 6-digit code by email. No passwords.
 * Emits once signed in (with a note if this device's trip couldn't be saved).
 */
@Component({
  selector: 'app-signin-panel',
  imports: [FormsModule],
  template: `
    @if (options(); as o) {
      @if (!o.google && !o.microsoft && !o.email) {
        <p class="muted" data-testid="signin-unavailable">Sign-in isn't set up on this server yet. The person who runs it needs to add Google, Microsoft or email settings.</p>
      } @else if (step() === 'code') {
        <form class="stack-v" (ngSubmit)="verify()">
          <p class="muted">We sent a 6-digit code to <strong>{{ email }}</strong>. It works for 15 minutes.</p>
          <div class="field">
            <label for="scode">Code</label>
            <input id="scode" class="input input--code" name="scode" [(ngModel)]="code" required inputmode="numeric"
              autocomplete="one-time-code" maxlength="7" placeholder="123456" data-testid="email-code" />
          </div>
          @if (error()) { <p class="error">{{ error() }}</p> }
          <button class="btn btn--primary btn--block" type="submit" [disabled]="busy() || code.replace(' ', '').length < 6">{{ busy() ? 'Checking…' : 'Sign in' }}</button>
          <div class="row" style="justify-content:space-between">
            <button class="btn btn--ghost btn--sm" type="button" (click)="step.set('start'); error.set('')">Use a different email</button>
            <button class="btn btn--ghost btn--sm" type="button" (click)="send()" [disabled]="busy()">Send a new code</button>
          </div>
        </form>
      } @else {
        <div class="stack-v" style="gap:10px">
          @if (o.google) {
            <button class="btn btn--block signin-btn" type="button" (click)="go('google')" data-testid="signin-google">
              <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
              Continue with Google
            </button>
          }
          @if (o.microsoft) {
            <button class="btn btn--block signin-btn" type="button" (click)="go('microsoft')" data-testid="signin-microsoft">
              <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>
              Continue with Microsoft
            </button>
          }
          @if (o.email) {
            @if (o.google || o.microsoft) { <div class="signin-or"><span>or</span></div> }
            <form class="stack-v" (ngSubmit)="send()">
              <div class="field">
                <label for="semail">Email</label>
                <input id="semail" class="input" name="semail" type="email" [(ngModel)]="email" required autocomplete="email"
                  inputmode="email" placeholder="you@example.com" data-testid="email-input" />
              </div>
              <button class="btn btn--tinted btn--block" type="submit" [disabled]="busy() || !email.trim()">{{ busy() ? 'Sending…' : 'Email me a sign-in code' }}</button>
            </form>
          }
          @if (error()) { <p class="error">{{ error() }}</p> }
          <p class="tiny">No passwords. We only use your email to sign you in.</p>
        </div>
      }
    } @else {
      <p class="muted">Loading…</p>
    }
  `,
})
export class SignInPanelComponent {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);

  /** In-app path to return to after a Google/Microsoft round trip. */
  readonly next = input('/trips');
  readonly signedIn = output<string>();

  readonly options = signal<SignInOptions | null>(null);
  readonly step = signal<'start' | 'code'>('start');
  readonly busy = signal(false);
  readonly error = signal('');
  email = '';
  code = '';

  constructor() {
    this.api
      .signInOptions()
      .then((o) => this.options.set(o))
      .catch(() => this.options.set({ google: false, microsoft: false, email: false }));
  }

  go(provider: 'google' | 'microsoft') {
    // Leaves the app; the provider sends the browser back to /auth/done.
    // ngsw-bypass keeps the offline service worker out of this navigation.
    window.location.href = `/api/auth/${provider}/start?returnTo=${encodeURIComponent(this.next())}&ngsw-bypass=1`;
  }

  async send() {
    this.error.set('');
    if (!/^\S+@\S+\.\S+$/.test(this.email.trim())) {
      this.error.set('That email address doesn’t look right');
      return;
    }
    this.busy.set(true);
    try {
      await this.api.emailStart(this.email.trim());
      this.code = '';
      this.step.set('code');
    } catch (e: unknown) {
      this.error.set(messageOf(e, "Couldn't send the code. Try again in a minute."));
    } finally {
      this.busy.set(false);
    }
  }

  async verify() {
    this.error.set('');
    this.busy.set(true);
    try {
      const s = await this.api.emailVerify({ email: this.email.trim(), code: this.code.replace(/\D/g, '') });
      this.signedIn.emit(await this.session.startAccount(s));
    } catch (e: unknown) {
      this.error.set(messageOf(e, "That code didn't work"));
    } finally {
      this.busy.set(false);
    }
  }
}

/** Only same-app paths, so links can't bounce people elsewhere after signing in. */
export function safeAppPath(n: string | null | undefined, fallback = '/trips'): string {
  return n && n.length <= 300 && /^\/(?!\/)[^\s\\]*$/.test(n) ? n : fallback;
}
