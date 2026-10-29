import { Component, computed, inject, input, output, signal } from '@angular/core';
import { InstallService } from '../core/install.service';
import { PushService } from '../core/push.service';
import { SessionService } from '../core/session.service';

const TOUR_KEY = 'letsgo.tour.v1';
/** Bumped whenever the tour gains steps that existing users should see once. */
const WHATS_NEW_KEY = 'letsgo.whatsnew.v2';

interface Step {
  art: string;
  title: string;
  body: string;
  demoVote?: boolean;
  action?: 'push' | 'install';
}

/**
 * First-visit walkthrough. Shown once per browser; replayable from the profile menu.
 * In "new" mode it shows only the steps added since the person last saw the tour.
 */
@Component({
  selector: 'app-tour',
  templateUrl: './tour.component.html',
})
export class TourComponent {
  private readonly session = inject(SessionService);
  readonly push = inject(PushService);
  readonly install = inject(InstallService);
  readonly mode = input<'full' | 'new'>('full');
  readonly done = output<void>();
  readonly index = signal(0);
  readonly pushError = signal('');
  readonly pushBusy = signal(false);

  private readonly newSteps: Step[] = [
    {
      art: '🔔',
      title: 'Never miss a vote',
      body: "The bell at the top shows what's new: votes on your ideas, comments, photos and plan changes. Turn on notifications and your phone gets a ping even when the app is closed.",
      action: 'push',
    },
    {
      art: '📲',
      title: 'Put LetsGo Together on your home screen',
      body: 'Install it like an app: full screen, no browser bar, and on iPhone this is what makes notifications work.',
      action: 'install',
    },
  ];

  readonly steps = computed<Step[]>(() => {
    if (this.mode() === 'new') return this.newSteps;
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
        body: 'On the Ideas tab, switch between To do and To eat and hit the big button. Paste a link to a place and we pull in the photos, address, menu and details for you.',
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
        art: '📷',
        title: 'Share the photos',
        body: 'The Photos tab is the family album. Add pictures from your phone, comment on them, and grab everything as one download.',
      },
      {
        art: '🏡',
        title: 'Where we\'re staying',
        body: 'The Stay tab has the address, map, check-in time, photos and house notes. Home shows the countdown and what everyone has been up to.',
      },
      ...this.newSteps,
    ];
  });
  readonly step = computed(() => this.steps()[this.index()]);
  readonly isLast = computed(() => this.index() === this.steps().length - 1);
  readonly demoOn = signal(false);

  /** Brand-new on this browser: show the whole tour. */
  static shouldShow(): boolean {
    try {
      return !localStorage.getItem(TOUR_KEY);
    } catch {
      return false;
    }
  }

  /** Took the tour before the newest steps existed: show just those, once. */
  static shouldShowWhatsNew(): boolean {
    try {
      return !!localStorage.getItem(TOUR_KEY) && !localStorage.getItem(WHATS_NEW_KEY);
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

  async enablePush() {
    this.pushError.set('');
    this.pushBusy.set(true);
    try {
      await this.push.enable();
    } catch {
      this.pushError.set(
        this.push.permission() === 'denied'
          ? 'Notifications are blocked for this site in your browser settings.'
          : "Couldn't turn on notifications right now. You can try again from your profile.",
      );
    } finally {
      this.pushBusy.set(false);
    }
  }

  async installApp() {
    await this.install.prompt();
  }

  finish() {
    try {
      localStorage.setItem(TOUR_KEY, '1');
      localStorage.setItem(WHATS_NEW_KEY, '1');
    } catch {
      /* ignore */
    }
    this.done.emit();
  }
}
