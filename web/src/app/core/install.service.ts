import { isNativeApp } from './platform';
import { Injectable, signal } from '@angular/core';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'letsgo.install.dismissed';

/**
 * Knows whether the app can be installed on this device and how.
 * Chrome/Edge/Android fire beforeinstallprompt; iPhone Safari needs the Share sheet.
 */
@Injectable({ providedIn: 'root' })
export class InstallService {
  private deferred: BeforeInstallPromptEvent | null = null;

  /** Native prompt available (Android / desktop Chrome). */
  readonly canPrompt = signal(false);
  readonly installed = signal(isStandalone() || isNativeApp());
  readonly isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
  readonly bannerDismissed = signal(readDismissed());

  constructor() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferred = e as BeforeInstallPromptEvent;
      this.canPrompt.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.installed.set(true);
      this.canPrompt.set(false);
      this.deferred = null;
    });
  }

  /** Something useful can be shown: either the native prompt or iPhone instructions. */
  get available(): boolean {
    return !this.installed() && (this.canPrompt() || this.isIos);
  }

  async prompt(): Promise<boolean> {
    if (!this.deferred) return false;
    await this.deferred.prompt();
    const { outcome } = await this.deferred.userChoice;
    this.deferred = null;
    this.canPrompt.set(false);
    return outcome === 'accepted';
  }

  dismissBanner() {
    this.bannerDismissed.set(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  }
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}
