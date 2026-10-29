import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { SessionService } from './session.service';

/** The trip member token goes in Authorization; the account session in X-Account. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api')) return next(req);
  const session = inject(SessionService);
  const headers: Record<string, string> = {};
  const token = session.token();
  const account = session.accountToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (account) headers['X-Account'] = account;
  return Object.keys(headers).length ? next(req.clone({ setHeaders: headers })) : next(req);
};
