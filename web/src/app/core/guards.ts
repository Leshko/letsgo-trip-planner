import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

/** Trip pages need a trip on this device; otherwise go to my trips, or pick/join one. */
export const signedInGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  const router = inject(Router);
  if (await session.restore()) return true;
  if (session.unreachable()) return router.createUrlTree(['/']);
  return (await session.restoreAccount()) ? router.createUrlTree(['/trips']) : router.createUrlTree(['/']);
};

/** The landing page sends people who already have a trip (or an account) straight in. */
export const signedOutGuard: CanActivateFn = async (route) => {
  const session = inject(SessionService);
  const router = inject(Router);
  // "Start a new trip" from My trips lands here on purpose.
  if (route.queryParamMap.get('create') === '1') return true;
  if (await session.restore()) return router.createUrlTree(['/trip']);
  // Unreachable: stay here; the landing page shows a "try again" card.
  if (session.unreachable()) return true;
  return (await session.restoreAccount()) ? router.createUrlTree(['/trips']) : true;
};

/** My trips needs an account. */
export const accountGuard: CanActivateFn = async (_route, state) => {
  const session = inject(SessionService);
  const router = inject(Router);
  return (await session.restoreAccount())
    ? true
    : router.createUrlTree(['/signin'], { queryParams: { next: state.url } });
};
