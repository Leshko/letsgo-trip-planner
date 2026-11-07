import { Capacitor } from '@capacitor/core';

/** The public web address. The phone apps talk to the server here and share links to it. */
export const PUBLIC_ORIGIN = 'https://letsgotogether.app';

/** Test builds can point the app at another server (set by the developer, never by a page). */
const SERVER_OVERRIDE_KEY = 'letsgo.appServer';

/** Running inside the iPhone or Android app rather than a browser. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export function nativePlatform(): 'ios' | 'android' | 'web' {
  const p = Capacitor.getPlatform();
  return p === 'ios' || p === 'android' ? p : 'web';
}

/** Where the API lives: the same site on the web, the public address in the apps. */
export function apiOrigin(): string {
  if (!isNativeApp()) return '';
  try {
    const o = localStorage.getItem(SERVER_OVERRIDE_KEY);
    if (o && /^https?:\/\/[^/]+$/.test(o)) return o;
  } catch {
    /* ignore */
  }
  return PUBLIC_ORIGIN;
}

/** The address people open in a browser: used for invite and share links. */
export function webOrigin(): string {
  return isNativeApp() ? apiOrigin() : location.origin;
}

/** The server hands out site-relative links (/api/...). The apps need them in full. */
export function absUrl(url: string): string {
  if (!url || !url.startsWith('/api/')) return url;
  return apiOrigin() + url;
}

/** Rewrites every "/api/..." string inside a JSON response to a full address (apps only). */
export function absolutizeApiUrls<T>(value: T): T {
  const origin = apiOrigin();
  if (!origin) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.startsWith('/api/') ? origin + v : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}
