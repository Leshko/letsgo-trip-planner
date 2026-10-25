import { Routes } from '@angular/router';
import { signedInGuard, signedOutGuard } from './core/guards';

export const routes: Routes = [
  {
    path: '',
    canActivate: [signedOutGuard],
    loadComponent: () => import('./pages/landing/landing.component').then((m) => m.LandingComponent),
  },
  {
    path: 'join/:code',
    loadComponent: () => import('./pages/landing/landing.component').then((m) => m.LandingComponent),
  },
  {
    path: 'trip',
    canActivate: [signedInGuard],
    loadComponent: () => import('./pages/shell/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', loadComponent: () => import('./pages/home/home.component').then((m) => m.HomeComponent) },
      { path: 'stay', loadComponent: () => import('./pages/stay/stay.component').then((m) => m.StayComponent) },
      {
        path: 'do',
        loadComponent: () => import('./pages/ideas/ideas.component').then((m) => m.IdeasComponent),
        data: { kind: 'activity' },
      },
      {
        path: 'eat',
        loadComponent: () => import('./pages/ideas/ideas.component').then((m) => m.IdeasComponent),
        data: { kind: 'food' },
      },
      { path: 'plan', loadComponent: () => import('./pages/itinerary/itinerary.component').then((m) => m.ItineraryComponent) },
      { path: 'wall', loadComponent: () => import('./pages/wall/wall.component').then((m) => m.WallComponent) },
    ],
  },
  { path: '**', redirectTo: '' },
];
