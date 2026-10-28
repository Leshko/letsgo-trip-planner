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
    ],
  },
  { path: '**', redirectTo: '' },
];
