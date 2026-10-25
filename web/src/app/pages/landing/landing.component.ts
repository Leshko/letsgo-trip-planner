import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { addDays, todayIso } from '../../core/format';
import { EmojiPickerComponent } from '../../shared/emoji-picker.component';

type Mode = 'join' | 'create';

@Component({
  selector: 'app-landing',
  imports: [FormsModule, EmojiPickerComponent],
  templateUrl: './landing.component.html',
})
export class LandingComponent {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  /** Bound from /join/:code by the router. */
  readonly code = input<string>();
  readonly mode = signal<Mode>('join');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly fromLink = computed(() => !!this.code());

  // join form
  joinCode = '';
  joinName = '';
  joinEmoji = '';

  // create form
  tripName = '';
  destination = '';
  startDate = addDays(todayIso(), 30);
  endDate = addDays(todayIso(), 34);
  memberName = '';
  createEmoji = '';

  constructor() {
    // The session may already exist when arriving via a /join link.
    void this.session.restore().then((signedIn) => {
      if (signedIn) void this.router.navigate(['/trip']);
    });
  }

  ngOnInit() {
    const c = this.code();
    if (c) {
      this.joinCode = c.toUpperCase();
      this.mode.set('join');
    }
  }

  async join() {
    this.error.set('');
    this.busy.set(true);
    try {
      const s = await this.api.joinTrip({ code: this.joinCode, name: this.joinName, emoji: this.joinEmoji });
      this.session.start(s);
      await this.router.navigate(['/trip']);
    } catch (e: unknown) {
      this.error.set(messageOf(e, "Couldn't find a trip with that code"));
    } finally {
      this.busy.set(false);
    }
  }

  async create() {
    this.error.set('');
    this.busy.set(true);
    try {
      const s = await this.api.createTrip({
        name: this.tripName,
        destination: this.destination,
        startDate: this.startDate,
        endDate: this.endDate,
        memberName: this.memberName,
        emoji: this.createEmoji,
      });
      this.session.start(s);
      await this.router.navigate(['/trip']);
    } catch (e: unknown) {
      this.error.set(messageOf(e, "Couldn't create the trip"));
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
