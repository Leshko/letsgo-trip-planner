import { Injectable, inject } from '@angular/core';
import { SessionService } from './session.service';
import { isNativeApp, webOrigin } from './platform';

export type ShareOutcome = 'shared' | 'copied' | 'failed';

/** Links the family can text: they carry the invite code and land on the thing shared. */
@Injectable({ providedIn: 'root' })
export class ShareService {
  private readonly session = inject(SessionService);

  url(path: string): string {
    const code = this.session.trip()?.inviteCode ?? '';
    return `${webOrigin()}/join/${code}?next=${encodeURIComponent(path)}`;
  }

  async share(opts: { title: string; text?: string; path: string }): Promise<ShareOutcome> {
    const url = this.url(opts.path);
    if (isNativeApp()) return nativeShare({ title: opts.title, text: opts.text, url });
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void>; canShare?: (d: ShareData) => boolean };
    if (nav.share) {
      try {
        await nav.share({ title: opts.title, text: opts.text, url });
        return 'shared';
      } catch (e) {
        if ((e as { name?: string }).name === 'AbortError') return 'failed';
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
}

/** The phone's own share sheet in the apps. */
export async function nativeShare(d: { title: string; text?: string; url?: string }): Promise<ShareOutcome> {
  try {
    const { Share } = await import('@capacitor/share');
    await Share.share({ title: d.title, text: d.text, url: d.url, dialogTitle: d.title });
    return 'shared';
  } catch {
    return 'failed';
  }
}
