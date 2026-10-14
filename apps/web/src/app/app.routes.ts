import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Solo Poker',
    loadComponent: () => import('./pages/home/home-page').then((m) => m.HomePage),
  },
  {
    path: 'crear',
    title: 'Nueva mesa · Solo Poker',
    loadComponent: () => import('./pages/create/create-page').then((m) => m.CreatePage),
  },
  {
    path: 'mesa/:tableId',
    title: 'Mesa · Solo Poker',
    loadComponent: () => import('./pages/table/table-page').then((m) => m.TablePage),
  },
  { path: '**', redirectTo: '' },
];
