import { Routes } from '@angular/router';
import { accountGuard, signedInGuard, signedOutGuard } from './core/guards';

export const routes: Routes = [
  {
    path: '',
    canActivate: [signedOutGuard],
    loadComponent: () => import('./pages/landing/landing.component').then((m) => m.LandingComponent),
  },
  {
    path: 'privacy',
    loadComponent: () => import('./pages/account/privacy.component').then((m) => m.PrivacyComponent),
  },
  {
    path: 'handoff',
    loadComponent: () => import('./pages/account/handoff.component').then((m) => m.HandoffComponent),
  },
  {
    path: 'signin',
    loadComponent: () => import('./pages/account/signin.component').then((m) => m.SignInPageComponent),
  },
  {
    path: 'auth/done',
    loadComponent: () => import('./pages/account/auth-callback.component').then((m) => m.AuthCallbackComponent),
  },
  {
    path: 'auth/email',
    loadComponent: () => import('./pages/account/auth-callback.component').then((m) => m.AuthCallbackComponent),
  },
  {
    path: 'trips',
    canActivate: [accountGuard],
    loadComponent: () => import('./pages/account/my-trips.component').then((m) => m.MyTripsComponent),
  },
  {
    path: 'admin',
    loadComponent: () => import('./pages/admin/admin.component').then((m) => m.AdminComponent),
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
      { path: 'ideas', pathMatch: 'full', redirectTo: 'ideas/do' },
      { path: 'do', redirectTo: 'ideas/do' },
      { path: 'eat', redirectTo: 'ideas/eat' },
      {
        path: 'ideas/:kind',
        loadComponent: () => import('./pages/ideas/ideas.component').then((m) => m.IdeasComponent),
      },
      { path: 'idea/:id', loadComponent: () => import('./pages/ideas/idea-detail.component').then((m) => m.IdeaDetailComponent) },
      { path: 'photos', loadComponent: () => import('./pages/photos/photos.component').then((m) => m.PhotosComponent) },
      { path: 'plan', loadComponent: () => import('./pages/itinerary/itinerary.component').then((m) => m.ItineraryComponent) },
      { path: 'wall', loadComponent: () => import('./pages/wall/wall.component').then((m) => m.WallComponent) },
      { path: 'map', loadComponent: () => import('./pages/map/map.component').then((m) => m.MapComponent) },
    ],
  },
  { path: '**', redirectTo: '' },
];
