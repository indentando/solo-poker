import { Injectable, signal } from '@angular/core';

const TICK_MS = 250;

/** Reloj compartido para cuentas atrás y temporizadores de turno. */
@Injectable({ providedIn: 'root' })
export class ClockService {
  readonly now = signal(Date.now());

  constructor() {
    setInterval(() => this.now.set(Date.now()), TICK_MS);
  }
}
