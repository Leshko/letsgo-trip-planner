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
import { IconComponent, IconName } from '../../shared/icon.component';
import { TransferCode } from '../../core/models';
import { squareThumbnail } from '../../core/image';
import { InstallService } from '../../core/install.service';
import { SwUpdate } from '@angular/service-worker';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule, AvatarComponent, AvatarStackComponent, EmojiPickerComponent, TourComponent, IconComponent],
  templateUrl: './shell.component.html',
})
export class ShellComponent {
  readonly session = inject(SessionService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly install = inject(InstallService);
  private readonly updates = inject(SwUpdate);
  readonly updateReady = signal(false);
  readonly showIosHelp = signal(false);

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

  readonly tabs: { path: string; label: string; ico: IconName; exact: boolean }[] = [
    { path: '/trip', label: 'Home', ico: 'home', exact: true },
    { path: '/trip/stay', label: 'Stay', ico: 'bed', exact: false },
    { path: '/trip/ideas', label: 'Ideas', ico: 'sparkles', exact: false },
    { path: '/trip/plan', label: 'Plan', ico: 'calendar', exact: false },
    { path: '/trip/wall', label: 'Wall', ico: 'bubble', exact: false },
    { path: '/trip/photos', label: 'Photos', ico: 'camera', exact: false },
  ];

  constructor() {
    // Keeps the member list (who's joined) fresh across every page.
    usePolling(() => this.session.refreshTrip(), 20_000);
    if (this.updates.isEnabled) {
      this.updates.versionUpdates.subscribe((e) => {
        if (e.type === 'VERSION_READY') this.updateReady.set(true);
      });
    }
  }

  async reloadForUpdate() {
    try {
      await this.updates.activateUpdate();
    } finally {
      document.location.reload();
    }
  }

  async installApp() {
    if (this.install.canPrompt()) {
      const ok = await this.install.prompt();
      if (ok) this.flash('Installed! Find LetsGo on your home screen');
      return;
    }
    this.showProfile.set(false);
    this.showIosHelp.set(true);
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

  readonly photoBusy = signal(false);

  async onPhotoPicked(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.photoBusy.set(true);
    this.profileError.set('');
    try {
      const dataUrl = await squareThumbnail(file);
      const m = await this.api.uploadAvatar(dataUrl);
      this.session.setMember(m);
      await this.session.refreshTrip();
    } catch (e: unknown) {
      this.profileError.set(messageOf(e, "Couldn't use that photo"));
    } finally {
      this.photoBusy.set(false);
    }
  }

  async removePhoto() {
    this.photoBusy.set(true);
    try {
      const m = await this.api.removeAvatar();
      this.session.setMember(m);
      await this.session.refreshTrip();
    } finally {
      this.photoBusy.set(false);
    }
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
