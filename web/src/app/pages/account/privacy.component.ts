import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Plain-language privacy page (sign-in providers ask for one). */
@Component({
  selector: 'app-privacy',
  imports: [RouterLink],
  template: `
    <div class="page landing">
      <div class="hero">
        <p class="chip chip--accent">🌴 LetsGo Together</p>
        <h1 class="mt">Privacy</h1>
        <p class="muted mt">LetsGo Together helps a family plan a trip together. Here's what it keeps and why.</p>
      </div>
      <section class="card mt stack-v privacy">
        <h2>What we keep</h2>
        <ul>
          <li><strong>Your trip spot:</strong> the name and avatar you pick, and what you add: ideas, votes, comments, wall posts, plan entries and photos.</li>
          <li><strong>Your account, if you sign in:</strong> your email address, the name you give, and an ID from the sign-in method you use so we recognise you next time. We never see or store a password.</li>
          <li><strong>Notifications, if you turn them on:</strong> the address your browser gives us to deliver them.</li>
        </ul>
        <h2>Who sees it</h2>
        <p>Only the people in the same trip see what's in that trip. Your email address is shown to no one in the trip. The person who runs this server can see the trips on it to help when someone loses access.</p>
        <h2>Other services</h2>
        <ul>
          <li>Sign-in codes are sent by email through Resend.</li>
          <li>When someone pastes a link to a place, the app reads that public page to fill in photos and details. If AI summaries are on, the page text is sent to Anthropic's Claude to write the summary.</li>
          <li>Nothing is sold or used for advertising.</li>
        </ul>
        <h2>Deleting your data</h2>
        <p>Delete your account any time from My trips → your name → Delete my account. This removes your account and sign-ins; the trips you were in stay for the rest of the family. To remove a trip spot or a whole trip, ask the trip's organizer or the person who runs this server.</p>
      </section>
      <p class="tiny mt" style="text-align:center"><a routerLink="/">Back to LetsGo Together</a></p>
    </div>
  `,
  styles: [`.privacy h2 { font-size: 18px; margin: 8px 0 0; } .privacy ul { margin: 0; padding-left: 20px; } .privacy li { margin: 4px 0; }`],
})
export class PrivacyComponent {}
