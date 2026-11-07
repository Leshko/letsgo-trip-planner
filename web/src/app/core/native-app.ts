import { NgZone, inject } from '@angular/core';
import { Router } from '@angular/router';
import { PUBLIC_ORIGIN, apiOrigin, isNativeApp, nativePlatform } from './platform';

/** Turns a link the phone handed us (https://letsgotogether.app/join/ABC) into an in-app route. */
export function inAppPath(url: string): string | null {
  try {
    const u = new URL(url);
    const known = new Set([new URL(PUBLIC_ORIGIN).host, apiOrigin() ? new URL(apiOrigin()).host : '']);
    if (!known.has(u.host)) return null;
    if (!/^\/(join\/|auth\/email|trip(\/|$)|trips$|signin$)/.test(u.pathname)) return null;
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

/**
 * Wires the phone apps into the system: links that open the app, the Android
 * back button, the status bar. Does nothing in a browser.
 */
export async function initNativeApp(): Promise<void> {
  if (!isNativeApp()) return;
  const router = inject(Router);
  const zone = inject(NgZone);
  const [{ App }, { StatusBar, Style }, { SplashScreen }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/status-bar'),
    import('@capacitor/splash-screen'),
  ]);

  // An invite or sign-in link tapped elsewhere on the phone.
  void App.addListener('appUrlOpen', ({ url }) => {
    const path = inAppPath(url);
    if (path) zone.run(() => void router.navigateByUrl(path));
  });

  if (nativePlatform() === 'android') {
    // Back goes back; on the first screen it sends the app to the background
    // (not closed, so family-map sharing keeps running).
    void App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) history.back();
      else void App.minimizeApp();
    });
  }

  await StatusBar.setStyle({ style: Style.Light }).catch(() => undefined);
  await SplashScreen.hide().catch(() => undefined);
}
