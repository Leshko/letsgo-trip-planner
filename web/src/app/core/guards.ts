import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

/** Trip pages need a session; otherwise go pick or join a trip. */
export const signedInGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  const router = inject(Router);
  return (await session.restore()) ? true : router.createUrlTree(['/']);
};

/** The landing page sends people who already have a trip straight in. */
export const signedOutGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  const router = inject(Router);
  return (await session.restore()) ? router.createUrlTree(['/trip']) : true;
};
