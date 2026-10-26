import { Component, computed, inject, output, signal } from '@angular/core';
import { SessionService } from '../core/session.service';

const TOUR_KEY = 'letsgo.tour.v1';

interface Step {
  art: string;
  title: string;
  body: string;
  demoVote?: boolean;
}

/** First-visit walkthrough. Shown once per browser; replayable from the profile menu. */
@Component({
  selector: 'app-tour',
  templateUrl: './tour.component.html',
})
export class TourComponent {
  private readonly session = inject(SessionService);
  readonly done = output<void>();
  readonly index = signal(0);

  readonly steps = computed<Step[]>(() => {
    const t = this.session.trip();
    const name = this.session.member()?.name ?? 'there';
    return [
      {
        art: '🌴',
        title: `Hi ${name}! Welcome to ${t?.name ?? 'the trip'}`,
        body: 'This is where the whole family plans the trip together. Takes a minute to show you around.',
      },
      {
        art: '',
        title: 'Voting is one tap',
        body: 'Every activity and restaurant has a thumbs-up. Tap it to say "I\'m in". The most popular ideas float to the top. Tap again to change your mind.',
        demoVote: true,
      },
      {
        art: '💡',
        title: 'Add your own ideas',
        body: 'On the Do and Eat tabs, hit the orange button. Paste a link to a place and we pull in the photos and details for you.',
      },
      {
        art: '💬',
        title: 'Talk it over',
        body: 'Every idea has comments. The Wall tab is for everything else: questions, hype, who\'s bringing what. React with emoji.',
      },
      {
        art: '🗓️',
        title: 'Build the plan',
        body: 'The Plan tab has a slot for every day of the trip. Add ideas straight from the list, give them a time, and drag them between days.',
      },
      {
        art: '🏡',
        title: 'Where we\'re staying',
        body: 'The Stay tab has the address, map, check-in time, photos and house notes. Home shows the countdown and what everyone has been up to.',
      },
    ];
  });
  readonly step = computed(() => this.steps()[this.index()]);
  readonly isLast = computed(() => this.index() === this.steps().length - 1);
  readonly demoOn = signal(false);

  static shouldShow(): boolean {
    try {
      return !localStorage.getItem(TOUR_KEY);
    } catch {
      return false;
    }
  }

  next() {
    if (this.isLast()) this.finish();
    else this.index.update((i) => i + 1);
  }

  back() {
    this.index.update((i) => Math.max(0, i - 1));
  }

  finish() {
    try {
      localStorage.setItem(TOUR_KEY, '1');
    } catch {
      /* ignore */
    }
    this.done.emit();
  }
}
