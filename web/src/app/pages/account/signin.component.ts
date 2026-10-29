import { Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SignInPanelComponent, safeAppPath } from './signin-panel.component';

const ERRORS: Record<string, string> = {
  cancelled: 'Sign-in was cancelled.',
  expired: 'That sign-in took too long. Please try again.',
  failed: "We couldn't confirm that sign-in. Please try again.",
  unavailable: "That sign-in option isn't set up on this server.",
};

@Component({
  selector: 'app-signin-page',
  imports: [SignInPanelComponent, RouterLink],
  template: `
    <div class="page landing">
      <div class="hero">
        <p class="chip chip--accent">🌴 LetsGo Together</p>
        <h1 class="mt">Sign in</h1>
        <p class="muted mt">See every trip you're part of, on any phone or computer.</p>
      </div>
      @if (errorText()) { <p class="card card--flat mt error" data-testid="signin-error">{{ errorText() }}</p> }
      <div class="card mt">
        <app-signin-panel [next]="target()" (signedIn)="done()" />
      </div>
      <p class="tiny mt" style="text-align:center"><a routerLink="/">Back</a></p>
    </div>
  `,
})
export class SignInPageComponent {
  private readonly router = inject(Router);
  readonly next = input<string>();
  readonly error = input<string>();
  readonly target = computed(() => safeAppPath(this.next()));
  readonly errorText = computed(() => ERRORS[this.error() ?? ''] ?? '');

  done() {
    void this.router.navigateByUrl(this.target());
  }
}
