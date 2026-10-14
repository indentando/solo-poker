import { Component, computed, input, output, signal } from '@angular/core';
import { computeLedger, settleUp, type PlayerView } from '@solo-poker/engine';
import { MoneyPipe, formatMoney } from '../../core/format';
import { Avatar } from '../../ui/avatar';

const COPIED_MS = 2_000;

/**
 * Pantalla de fin de partida: ganador, cuentas de cada jugador (lo que puso
 * con entrada y recompras frente a lo que se lleva) y los pagos para saldarlas.
 * Es una pantalla normal, no una capa encima de la mesa.
 */
@Component({
  selector: 'app-game-summary',
  imports: [MoneyPipe, Avatar],
  template: `
    <section class="pt-10 text-center">
      @if (winner(); as w) {
        <app-avatar class="text-7xl" [value]="w.avatar" />
      }
      <h1 class="mt-4 text-3xl font-extralight">{{ title() }}</h1>
      <p class="mt-2 text-muted">{{ subtitle() }}</p>
    </section>

    <section class="mt-10">
      <h2 class="label">Cuentas</h2>
      <ul class="flex flex-col gap-2">
        @for (row of rows(); track row.id) {
          <li class="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3">
            <app-avatar class="w-8 text-[1.75rem]" [value]="row.avatar" />
            <div class="min-w-0 flex-1">
              <div class="truncate">{{ row.name }}</div>
              <div class="text-xs text-muted">
                Puso {{ row.paidIn | money }}{{ row.rebuys > 0 ? ' (' + row.rebuys + ' recompra' + (row.rebuys > 1 ? 's' : '') + ')' : '' }}
                · acaba con {{ row.final | money }}
              </div>
            </div>
            <div class="text-right text-lg font-light tabular-nums"
                 [class.text-win]="row.net > 0" [class.text-suit-red]="row.net < 0" [class.text-muted]="row.net === 0">
              {{ row.net > 0 ? '+' : row.net < 0 ? '−' : '' }}{{ abs(row.net) | money }}
            </div>
          </li>
        }
      </ul>
    </section>

    <section class="mt-8">
      <h2 class="label">Para saldar cuentas</h2>
      @if (payments().length > 0) {
        <ul class="flex flex-col gap-2">
          @for (payment of payments(); track $index) {
            <li class="flex items-center justify-between rounded-2xl border-[1.5px] border-line px-4 py-3">
              <span>{{ payment.text }}</span>
              <span class="tabular-nums">{{ payment.amount | money }}</span>
            </li>
          }
        </ul>
      } @else {
        <p class="rounded-2xl border-[1.5px] border-line px-4 py-3 text-muted">Nadie debe nada a nadie.</p>
      }
    </section>

    <section class="mt-auto flex flex-col gap-3 py-8">
      <button class="btn" (click)="copy()">{{ copied() ? '¡Resumen copiado!' : 'Copiar resumen' }}</button>
      <button class="btn btn-primary" (click)="leave.emit()">Volver al inicio</button>
    </section>
  `,
  host: { class: 'flex flex-1 flex-col' },
})
export class GameSummary {
  readonly view = input.required<PlayerView>();
  readonly leave = output<void>();

  protected readonly copied = signal(false);
  protected readonly abs = Math.abs;

  private readonly nameOf = computed(() => {
    const view = this.view();
    return (id: string) => (id === view.you?.id ? 'Tú' : (view.players.find((p) => p.id === id)?.nickname ?? '?'));
  });

  protected readonly winner = computed(() => this.view().players.find((p) => p.id === this.view().winnerId) ?? null);

  protected readonly title = computed(() => {
    const view = this.view();
    if (view.winnerId === view.you?.id) return '¡Has ganado la partida!';
    const winner = this.winner();
    return winner ? `${winner.nickname} gana la partida` : 'Partida terminada';
  });

  protected readonly subtitle = computed(() => {
    const view = this.view();
    const hands = `${view.handNumber} ${view.handNumber === 1 ? 'mano' : 'manos'}`;
    if (view.startedAt === null || view.finishedAt === null) return hands;
    const minutes = Math.max(1, Math.round((view.finishedAt - view.startedAt) / 60_000));
    const duration = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
    return `${hands} · ${duration}`;
  });

  private readonly ledger = computed(() => computeLedger(this.view().players, this.view().buyIn));

  protected readonly rows = computed(() => {
    const view = this.view();
    const name = this.nameOf();
    return this.ledger().map((entry) => ({
      id: entry.playerId,
      name: name(entry.playerId),
      avatar: view.players.find((p) => p.id === entry.playerId)?.avatar ?? '',
      paidIn: entry.paidIn,
      final: entry.final,
      net: entry.net,
      rebuys: entry.rebuys,
    }));
  });

  protected readonly payments = computed(() => {
    const me = this.view().you?.id;
    const name = this.nameOf();
    return settleUp(this.ledger()).map((p) => ({
      amount: p.amount,
      text:
        p.from === me
          ? `Pagas a ${name(p.to)}`
          : p.to === me
            ? `${name(p.from)} te paga`
            : `${name(p.from)} paga a ${name(p.to)}`,
    }));
  });

  /** Texto para pegar en el grupo de WhatsApp: con los nombres de todos, sin "tú". */
  protected async copy(): Promise<void> {
    const view = this.view();
    const nick = (id: string) => view.players.find((p) => p.id === id)?.nickname ?? '?';
    const winner = this.winner();
    const payments = settleUp(this.ledger());
    const lines = [
      `Solo Poker · ${winner ? `gana ${winner.nickname}` : 'partida terminada'} (${this.subtitle()})`,
      '',
      ...this.ledger().map((e) => `${nick(e.playerId)}: ${e.net > 0 ? '+' : ''}${formatMoney(e.net)}`),
      '',
      ...(payments.length > 0
        ? payments.map((p) => `${nick(p.from)} paga a ${nick(p.to)}: ${formatMoney(p.amount)}`)
        : ['Nadie debe nada a nadie.']),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), COPIED_MS);
    } catch {
      // Sin acceso al portapapeles (http en red local): no hacemos nada.
    }
  }
}
