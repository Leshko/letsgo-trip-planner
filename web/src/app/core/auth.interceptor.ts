import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { map } from 'rxjs';
import { SessionService } from './session.service';
import { absolutizeApiUrls, apiOrigin } from './platform';

/**
 * The trip member token goes in Authorization; the account session in X-Account.
 * In the phone apps the API is on the public address, so requests and the
 * links in responses (photos, avatars) get the full address.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api')) return next(req);
  const session = inject(SessionService);
  const headers: Record<string, string> = {};
  const token = session.token();
  const account = session.accountToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (account) headers['X-Account'] = account;
  const origin = apiOrigin();
  const out = req.clone({ url: origin + req.url, setHeaders: headers });
  if (!origin) return next(out);
  return next(out).pipe(
    map((ev) => (ev instanceof HttpResponse && ev.body && typeof ev.body === 'object' ? ev.clone({ body: absolutizeApiUrls(ev.body) }) : ev)),
  );
};
