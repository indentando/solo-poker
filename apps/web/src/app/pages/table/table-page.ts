import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { normalizeTableId, type TableInfo } from '@solo-poker/protocol';
import { errorMessage } from '../../core/format';
import { loadSession } from '../../core/storage';
import { TableService } from '../../core/table.service';
import { BackIcon } from '../../ui/back-icon';
import { GameTable } from './game-table';
import { JoinForm } from './join-form';
import { WaitingRoom } from './waiting-room';

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'join'; info: TableInfo }
  | { kind: 'seated' };

/**
 * Página de una mesa (/mesa/:tableId). Si ya tienes sesión, vuelve a sentarte;
 * si no, muestra el formulario para unirte. Una vez sentado: sala de espera o partida.
 */
@Component({
  selector: 'app-table-page',
  imports: [RouterLink, BackIcon, JoinForm, WaitingRoom, GameTable],
  template: `
    <main class="page" [class.page-wide]="inGame()">
      @switch (phase().kind) {
        @case ('loading') {
          <div class="flex flex-1 items-center justify-center text-muted">Cargando mesa…</div>
        }
        @case ('error') {
          <header class="flex h-16 items-center">
            <a routerLink="/" class="icon-btn" aria-label="Volver"><app-back-icon /></a>
          </header>
          <div class="flex flex-1 flex-col items-center justify-center gap-6 text-center">
            <p class="text-lg font-light">{{ errorText() }}</p>
            <a routerLink="/" class="btn px-8">Volver al inicio</a>
          </div>
        }
        @case ('join') {
          <header class="flex h-16 items-center">
            <a routerLink="/" class="icon-btn" aria-label="Volver"><app-back-icon /></a>
          </header>
          <app-join-form [info]="joinInfo()!" (joined)="phase.set({ kind: 'seated' })" />
        }
        @case ('seated') {
          @if (view(); as view) {
            @if (view.status === 'waiting') {
              <header class="flex h-16 items-center">
                <button class="icon-btn" aria-label="Salir de la mesa" (click)="confirmLeave.set(true)">
                  <app-back-icon />
                </button>
              </header>
              <app-waiting-room [view]="view" [countdownAt]="table.countdownAt()" />
            } @else {
              <app-game-table (leave)="requestLeave()" />
            }
          } @else {
            <div class="flex flex-1 items-center justify-center text-muted">Cargando mesa…</div>
          }
        }
      }
    </main>

    @if (table.replaced()) {
      <div class="sheet-backdrop">
        <div class="sheet text-center" animate.enter="sheet-enter">
          <h2 class="text-xl font-light">Has abierto esta mesa en otro sitio</h2>
          <p class="mt-2 text-sm text-muted">Solo puedes jugar desde una pestaña o dispositivo a la vez.</p>
          <button class="btn btn-primary mt-6 w-full" (click)="table.takeOver()">Jugar aquí</button>
        </div>
      </div>
    } @else if (table.session() && !table.connected()) {
      <div class="fixed inset-x-0 top-0 z-40 flex justify-center p-3" animate.enter="fade-enter">
        <p class="rounded-full bg-suit-red px-4 py-2 text-sm">Sin conexión. Reconectando…</p>
      </div>
    }

    @if (confirmLeave()) {
      <div class="sheet-backdrop" (click)="confirmLeave.set(false)">
        <div class="sheet" animate.enter="sheet-enter" (click)="$event.stopPropagation()">
          <h2 class="text-xl font-light">¿Salir de la mesa?</h2>
          <p class="mt-2 text-sm text-muted">{{ leaveWarning() }}</p>
          <div class="mt-6 grid grid-cols-2 gap-3">
            <button class="btn" (click)="confirmLeave.set(false)">Seguir</button>
            <button class="btn btn-primary" (click)="leave()">Salir</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class TablePage {
  private readonly router = inject(Router);
  protected readonly table = inject(TableService);

  /** Parámetro de la ruta. */
  readonly tableId = input.required<string>();

  protected readonly phase = signal<Phase>({ kind: 'loading' });
  protected readonly confirmLeave = signal(false);
  protected readonly view = this.table.view;

  /** Con la partida en marcha, en escritorio la mesa usa todo el ancho. */
  protected readonly inGame = computed(
    () => this.phase().kind === 'seated' && !!this.view() && this.view()!.status !== 'waiting',
  );

  protected readonly errorText = computed(() => {
    const phase = this.phase();
    return phase.kind === 'error' ? phase.message : '';
  });
  protected readonly joinInfo = computed(() => {
    const phase = this.phase();
    return phase.kind === 'join' ? phase.info : null;
  });
  protected readonly leaveWarning = computed(() => {
    const view = this.view();
    if (view?.status === 'playing' && this.table.me()?.status === 'active') {
      return 'La partida está en curso: si sales, quedarás eliminado y perderás tus fichas.';
    }
    return 'Dejarás libre tu asiento.';
  });

  private leaving = false;

  constructor() {
    effect(() => {
      const raw = this.tableId();
      untracked(() => void this.load(raw));
    });

    // El servidor nos ha sacado de la mesa (p. ej. al reconectar fuera de plazo).
    effect(() => {
      const lostSeat = this.phase().kind === 'seated' && !this.table.session();
      if (lostSeat && !this.leaving) {
        untracked(() => this.phase.set({ kind: 'error', message: 'Ya no estás sentado en esta mesa.' }));
      }
    });
  }

  private async load(raw: string): Promise<void> {
    const tableId = normalizeTableId(raw);
    if (!tableId) {
      this.phase.set({ kind: 'error', message: 'Ese código de mesa no es válido.' });
      return;
    }
    if (tableId !== raw) {
      // Normaliza la URL (minúsculas, sin guion…) conservando el fragmento con la clave.
      void this.router.navigate(['/mesa', tableId], { replaceUrl: true, preserveFragment: true });
      return;
    }

    // Ya sentado (p. ej. viniendo de crear la mesa).
    if (this.table.session()?.tableId === tableId) {
      this.phase.set({ kind: 'seated' });
      return;
    }

    if (loadSession(tableId)) {
      const rejoined = await this.table.rejoin(tableId);
      if (rejoined.ok) {
        this.phase.set({ kind: 'seated' });
        return;
      }
    }

    const info = await this.table.info(tableId);
    this.phase.set(
      info.ok ? { kind: 'join', info: info.table } : { kind: 'error', message: errorMessage(info.error) },
    );
  }

  /** Salir con la partida terminada no necesita confirmación. */
  protected requestLeave(): void {
    if (this.view()?.status === 'finished' || this.table.me()?.status === 'eliminated') void this.leave();
    else this.confirmLeave.set(true);
  }

  protected async leave(): Promise<void> {
    this.leaving = true;
    this.confirmLeave.set(false);
    await this.table.leave();
    void this.router.navigate(['/']);
  }
}
