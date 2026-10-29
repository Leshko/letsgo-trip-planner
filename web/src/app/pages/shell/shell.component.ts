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
import { AgoPipe } from '../../shared/pipes';
import { TransferCode } from '../../core/models';
import { squareThumbnail } from '../../core/image';
import { InstallService } from '../../core/install.service';
import { SwPush, SwUpdate } from '@angular/service-worker';
import { ActivatedRoute } from '@angular/router';
import { PushService } from '../../core/push.service';
import { Notification, NotifyPrefs } from '../../core/models';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule, AvatarComponent, AvatarStackComponent, EmojiPickerComponent, TourComponent, IconComponent, AgoPipe],
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
  readonly push = inject(PushService);
  private readonly swPush = inject(SwPush);
  private readonly route = inject(ActivatedRoute);
  readonly notifs = signal<Notification[]>([]);
  readonly unread = signal(0);
  readonly showNotifs = signal(false);
  readonly notifsLoaded = signal(false);
  readonly pushError = signal('');
  readonly prefLabels: { key: keyof NotifyPrefs; label: string }[] = [
    { key: 'ideas', label: 'New ideas' },
    { key: 'votes', label: 'Votes on my ideas' },
    { key: 'comments', label: 'Comments' },
    { key: 'wall', label: 'Wall posts' },
    { key: 'plan', label: 'Plan and stay changes' },
    { key: 'photos', label: 'New photos' },
    { key: 'members', label: 'Someone joins' },
  ];

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
  /** Members who took the tour before notifications and install existed see just those steps, once. */
  readonly showWhatsNew = signal(!TourComponent.shouldShow() && TourComponent.shouldShowWhatsNew());
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
    usePolling(() => this.loadNotifs(), 20_000);
    void this.push.sync();
    if (this.swPush.isEnabled) {
      this.swPush.messages.subscribe((m) => {
        const body = (m as { notification?: { body?: string } }).notification?.body;
        if (body) this.flash(body);
        void this.loadNotifs();
      });
      this.swPush.notificationClicks.subscribe(() => void this.loadNotifs());
    }
    // Arrived from a push: mark that one read and drop the marker from the URL.
    const n = this.route.snapshot.queryParamMap.get('n');
    if (n) {
      void this.api.markNotificationsRead(this.session.tripId(), [n]).then(() => this.loadNotifs());
      void this.router.navigate([], { queryParams: { n: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  async loadNotifs() {
    const id = this.session.tripId();
    if (!id) return;
    const page = await this.api.notifications(id, 30);
    this.notifs.set(page.items);
    this.unread.set(page.unreadCount);
    this.notifsLoaded.set(true);
  }

  async openNotif(n: Notification) {
    this.showNotifs.set(false);
    if (!n.read) {
      this.notifs.update((all) => all.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      this.unread.update((u) => Math.max(0, u - 1));
      void this.api.markNotificationsRead(this.session.tripId(), [n.id]);
    }
    await this.router.navigateByUrl(n.url);
  }

  async markAllRead() {
    this.notifs.update((all) => all.map((x) => ({ ...x, read: true })));
    this.unread.set(0);
    await this.api.markNotificationsRead(this.session.tripId());
  }

  async togglePush() {
    this.pushError.set('');
    try {
      if (this.push.subscribed()) {
        await this.push.disable();
        this.flash('Notifications off on this device');
      } else {
        await this.push.enable();
        this.flash('Notifications on');
      }
    } catch (e: unknown) {
      this.pushError.set(
        this.push.permission() === 'denied'
          ? 'Notifications are blocked for this site in your browser settings.'
          : messageOf(e, "Couldn't turn on notifications"),
      );
    }
  }

  async setPref(key: keyof NotifyPrefs, value: boolean) {
    const res = await this.api.updateNotifyPrefs({ [key]: value });
    this.session.setNotifyPrefs(res.notifyPrefs);
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
    const text = `Join "${t.name}" on LetsGo Together: ${this.inviteUrl()}  (code ${t.inviteCode})`;
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
    this.showWhatsNew.set(false);
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
    await this.push.disable().catch(() => undefined);
    this.session.signOut();
    await this.router.navigate(['/']);
  }
}
