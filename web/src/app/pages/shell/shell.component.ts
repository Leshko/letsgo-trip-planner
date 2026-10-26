import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { dateRangeLabel } from '../../core/format';
import { usePolling } from '../../core/polling';
import { AvatarComponent } from '../../shared/avatar.component';
import { AvatarStackComponent } from '../../shared/avatar-stack.component';
import { EmojiPickerComponent } from '../../shared/emoji-picker.component';
import { messageOf } from '../landing/landing.component';
import { TourComponent } from '../../shared/tour.component';
import { TransferCode } from '../../core/models';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule, AvatarComponent, AvatarStackComponent, EmojiPickerComponent, TourComponent],
  templateUrl: './shell.component.html',
})
export class ShellComponent {
  readonly session = inject(SessionService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  readonly trip = this.session.trip;
  readonly me = this.session.member;
  readonly dates = computed(() => {
    const t = this.trip();
    return t ? dateRangeLabel(t.startDate, t.endDate) : '';
  });
  readonly inviteUrl = computed(() => `${location.origin}/join/${this.trip()?.inviteCode ?? ''}`);

  readonly showInvite = signal(false);
  readonly showProfile = signal(false);
  readonly showTour = signal(TourComponent.shouldShow());
  readonly transfer = signal<TransferCode | null>(null);
  readonly transferBusy = signal(false);
  readonly transferLeft = signal('');
  private transferTimer: ReturnType<typeof setInterval> | null = null;
  readonly toast = signal('');
  readonly profileError = signal('');
  profileName = '';
  profileEmoji = '';

  readonly tabs = [
    { path: '/trip', label: 'Home', ico: '🏠', exact: true },
    { path: '/trip/stay', label: 'Stay', ico: '🏡', exact: false },
    { path: '/trip/do', label: 'Do', ico: '🎯', exact: false },
    { path: '/trip/eat', label: 'Eat', ico: '🍽️', exact: false },
    { path: '/trip/plan', label: 'Plan', ico: '🗓️', exact: false },
    { path: '/trip/wall', label: 'Wall', ico: '💬', exact: false },
  ];

  constructor() {
    // Keeps the member list (who's joined) fresh across every page.
    usePolling(() => this.session.refreshTrip(), 20_000);
  }

  async share() {
    const t = this.trip();
    if (!t) return;
    const text = `Join "${t.name}" on LetsGo: ${this.inviteUrl()}  (code ${t.inviteCode})`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: t.name, text, url: this.inviteUrl() });
        return;
      } catch {
        /* user dismissed; fall through to copy */
      }
    }
    await this.copy(text);
  }

  async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.flash('Copied!');
    } catch {
      this.flash('Select and copy the text above');
    }
  }

  flash(msg: string) {
    this.toast.set(msg);
    setTimeout(() => this.toast.set(''), 1800);
  }

  async makeTransferCode() {
    this.transferBusy.set(true);
    try {
      const t = await this.api.createTransferCode();
      this.transfer.set(t);
      this.tickTransfer();
      if (this.transferTimer) clearInterval(this.transferTimer);
      this.transferTimer = setInterval(() => this.tickTransfer(), 1000);
    } catch (e: unknown) {
      this.profileError.set(messageOf(e, "Couldn't make a code"));
    } finally {
      this.transferBusy.set(false);
    }
  }

  private tickTransfer() {
    const t = this.transfer();
    if (!t) return;
    const left = Math.max(0, Math.round((t.expiresAt - Date.now()) / 1000));
    if (left === 0) {
      this.transfer.set(null);
      if (this.transferTimer) clearInterval(this.transferTimer);
      return;
    }
    this.transferLeft.set(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
  }

  startTour() {
    this.showProfile.set(false);
    this.showTour.set(true);
  }

  openProfile() {
    this.transfer.set(null);
    this.profileName = this.me()?.name ?? '';
    this.profileEmoji = this.me()?.emoji ?? '';
    this.profileError.set('');
    this.showProfile.set(true);
  }

  async saveProfile() {
    try {
      const m = await this.api.updateProfile({ name: this.profileName, emoji: this.profileEmoji });
      this.session.setMember(m);
      await this.session.refreshTrip();
      this.showProfile.set(false);
    } catch (e: unknown) {
      this.profileError.set(messageOf(e, "Couldn't save"));
    }
  }

  async leave() {
    if (!confirm('Leave this trip on this device? You can rejoin any time with the invite code.')) return;
    this.session.signOut();
    await this.router.navigate(['/']);
  }
}
