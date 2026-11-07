import { ApplicationConfig, isDevMode, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth.interceptor';
import { moveToMainAddress } from './core/main-address';
import { isNativeApp } from './core/platform';
import { initNativeApp } from './core/native-app';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Opened on an old web address: carry sign-ins over to the main one first.
    provideAppInitializer(() => moveToMainAddress()),
    // In the phone apps: links, back button, status bar.
    provideAppInitializer(() => initNativeApp()),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    provideHttpClient(withInterceptors([authInterceptor])),
    // The phone apps carry their files with them; the offline service worker is for browsers.
    provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode() && !isNativeApp(), registrationStrategy: 'registerWhenStable:30000' }),
  ],
};
