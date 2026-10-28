import { Injectable, inject } from '@angular/core';
import { SessionService } from './session.service';

export type ShareOutcome = 'shared' | 'copied' | 'failed';

/** Links the family can text: they carry the invite code and land on the thing shared. */
@Injectable({ providedIn: 'root' })
export class ShareService {
  private readonly session = inject(SessionService);

  url(path: string): string {
    const code = this.session.trip()?.inviteCode ?? '';
    return `${location.origin}/join/${code}?next=${encodeURIComponent(path)}`;
  }

  async share(opts: { title: string; text?: string; path: string }): Promise<ShareOutcome> {
    const url = this.url(opts.path);
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
