import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { SignInOptions } from './models';

const NONE: SignInOptions = { google: false, microsoft: false, email: false };

/** Which sign-in methods this server offers, fetched once, and how to say them in a sentence. */
@Injectable({ providedIn: 'root' })
export class SignInOptionsService {
  private readonly api = inject(ApiService);
  private loading: Promise<SignInOptions> | null = null;

  readonly options = signal<SignInOptions | null>(null);
  /** e.g. "your email", "Google or your email", "Google, Microsoft or your email". */
  readonly phrase = computed(() => signInPhrase(this.options()));

  load(): Promise<SignInOptions> {
    this.loading ??= this.api
      .signInOptions()
      .catch(() => NONE)
      .then((o) => {
        this.options.set(o);
        return o;
      });
    return this.loading;
  }
}

export function signInPhrase(o: SignInOptions | null): string {
  const names = [o?.google ? 'Google' : '', o?.microsoft ? 'Microsoft' : '', o?.email || !o ? 'your email' : ''].filter(Boolean);
  if (names.length <= 1) return names[0] ?? 'your email';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}
