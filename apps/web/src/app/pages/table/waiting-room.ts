import { Component, computed, inject, input, signal } from '@angular/core';
import type { PlayerView } from '@solo-poker/engine';
import { ClockService } from '../../core/clock.service';
import { MoneyPipe } from '../../core/format';
import { Avatar } from '../../ui/avatar';
import { recallPassword } from '../../core/storage';

type CopyTarget = 'link' | 'linkWithKey';

/** Copia al portapapeles, con alternativa para http en red local (sin API de portapapeles). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
}

@Component({
  selector: 'app-waiting-room',
  imports: [MoneyPipe, Avatar],
  template: `
    <div class="mb-8">
      <p class="text-sm text-muted">Mesa</p>
      <h1 class="text-4xl font-extralight tracking-[0.15em]">{{ view().tableId }}</h1>
      <p class="mt-2 text-muted">
        Entrada {{ view().buyIn | money }} · Ciegas {{ view().blinds.sb | money }} / {{ view().blinds.bb | money }}
      </p>
    </div>

    <section class="flex-1">
      <div class="mb-3 flex items-baseline justify-between">
        <span class="label !mb-0">Jugadores</span>
        <span class="text-sm tabular-nums text-muted">{{ view().players.length }}/{{ view().maxPlayers }}</span>
      </div>
      <ul class="flex flex-col gap-2">
        @for (player of view().players; track player.id) {
          <li class="flex h-14 items-center gap-3 rounded-2xl bg-surface px-4" animate.enter="fade-enter">
            <app-avatar class="w-8 text-[1.75rem]" [value]="player.avatar" />
            <span class="flex-1 truncate">{{ player.nickname }}</span>
            @if (player.id === view().you?.id) {
              <span class="text-sm text-muted">Tú</span>
            }
          </li>
        }
        @for (slot of emptySlots(); track slot) {
          <li class="flex h-14 items-center rounded-2xl border border-dashed border-line px-4 text-muted">
            Esperando jugador…
          </li>
        }
      </ul>
    </section>

    <section class="flex flex-col gap-3 py-8">
      @if (secondsLeft() !== null) {
        <p class="py-3 text-center text-xl font-light" animate.enter="fade-enter">
          La partida empieza en {{ secondsLeft() }}…
        </p>
      } @else {
        <p class="text-center text-sm text-muted">
          Comparte el enlace. La partida empieza cuando la mesa esté completa.
        </p>
        <button class="btn" (click)="copy('link')">
          {{ copied() === 'link' ? '¡Enlace copiado!' : 'Copiar enlace' }}
        </button>
        @if (password()) {
          <button class="btn" (click)="copy('linkWithKey')">
            {{ copied() === 'linkWithKey' ? '¡Copiado!' : 'Copiar enlace con clave' }}
          </button>
          <p class="text-center text-xs text-muted">Con clave, quien tenga el enlace puede sentarse directamente.</p>
        }
      }
    </section>
  `,
  host: { class: 'flex flex-1 flex-col' },
})
export class WaitingRoom {
  private readonly clock = inject(ClockService);

  readonly view = input.required<PlayerView>();
  /** Inicio de la partida en hora local, o null. */
  readonly countdownAt = input<number | null>(null);

  protected readonly copied = signal<CopyTarget | null>(null);

  protected readonly password = computed(() => recallPassword(this.view().tableId));
  protected readonly emptySlots = computed(() =>
    Array.from({ length: this.view().maxPlayers - this.view().players.length }, (_, i) => i),
  );
  protected readonly secondsLeft = computed(() => {
    const at = this.countdownAt();
    return at === null ? null : Math.max(0, Math.ceil((at - this.clock.now()) / 1000));
  });

  protected async copy(target: CopyTarget): Promise<void> {
    const link = `${window.location.origin}/mesa/${this.view().tableId}`;
    const password = this.password();
    const text = target === 'linkWithKey' && password ? `${link}#k=${encodeURIComponent(password)}` : link;
    if (await copyText(text)) {
      this.copied.set(target);
      setTimeout(() => this.copied.set(null), 2000);
    }
  }
}
