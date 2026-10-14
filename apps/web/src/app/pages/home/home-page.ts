import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { normalizeTableId } from '@solo-poker/protocol';
import { TableService } from '../../core/table.service';

@Component({
  selector: 'app-home-page',
  imports: [FormsModule, RouterLink],
  template: `
    <main class="page justify-between gap-10">
      <header class="pt-20">
        <h1 class="text-6xl font-extralight leading-[0.95] tracking-tight">Solo<br />Poker</h1>
        <p class="mt-3 text-lg font-light text-muted">Póker con amigos, sin registros.</p>
      </header>

      <div class="flex flex-col gap-6 pb-10">
        @if (activeTable(); as tableId) {
          <section class="rounded-3xl bg-surface p-5" animate.enter="fade-enter">
            <p class="text-sm text-muted">Estás sentado en la mesa</p>
            <p class="mt-1 text-2xl font-light tracking-[0.2em]">{{ tableId }}</p>
            <div class="mt-4 grid grid-cols-2 gap-3">
              <button class="btn btn-sm" (click)="leave()">Salir</button>
              <a class="btn btn-sm btn-primary" [routerLink]="['/mesa', tableId]">Volver</a>
            </div>
          </section>
        }

        <a class="btn btn-primary" routerLink="/crear">Crear mesa</a>

        <form class="flex flex-col gap-3" (ngSubmit)="join()">
          <span class="label !mb-0 text-center">o únete con un código</span>
          <div class="flex gap-3">
            <input
              class="field flex-1 text-center uppercase tracking-[0.2em]"
              name="code"
              [(ngModel)]="code"
              placeholder="K7X-92Q"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              maxlength="8"
              aria-label="Código de mesa"
            />
            <button class="btn" type="submit" [disabled]="!code().trim()">Unirse</button>
          </div>
          @if (error(); as message) {
            <p class="text-center text-sm text-suit-red">{{ message }}</p>
          }
        </form>
      </div>
    </main>
  `,
})
export class HomePage {
  private readonly router = inject(Router);
  private readonly table = inject(TableService);

  protected readonly code = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly activeTable = computed(() => this.table.session()?.tableId ?? null);

  protected join(): void {
    const tableId = normalizeTableId(this.code());
    if (!tableId) {
      this.error.set('El código tiene 6 caracteres, por ejemplo K7X-92Q.');
      return;
    }
    void this.router.navigate(['/mesa', tableId]);
  }

  protected leave(): Promise<void> {
    return this.table.leave();
  }
}
