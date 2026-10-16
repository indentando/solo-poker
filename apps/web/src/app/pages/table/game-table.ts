import { Component, DestroyRef, computed, effect, inject, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Action, Card, PlayerView } from '@solo-poker/engine';
import { ClockService } from '../../core/clock.service';
import { HAND_LABELS, MoneyPipe, errorMessage, formatMoney } from '../../core/format';
import { SoundService } from '../../core/sound.service';
import { TableService } from '../../core/table.service';
import { Avatar } from '../../ui/avatar';
import { BackIcon } from '../../ui/back-icon';
import { PlayingCard } from '../../ui/playing-card';
import { Seat } from '../../ui/seat';
import { ActionBar } from './action-bar';
import { HandLog } from './hand-log';

const TOAST_MS = 3_000;
const BOARD_SIZE = 5;
/** Aviso sonoro cuando te quedan estos milisegundos de turno. */
const TIME_WARNING_MS = 5_000;

/** La mesa durante la partida: rivales arriba, tablero en el centro y tu mano abajo. */
@Component({
  selector: 'app-game-table',
  imports: [MoneyPipe, PlayingCard, Seat, ActionBar, BackIcon, Avatar, HandLog],
  template: `
    @let v = view();
    <header class="flex h-14 items-center justify-between">
      <button class="icon-btn" aria-label="Salir de la mesa" (click)="leave.emit()"><app-back-icon /></button>
      <div class="flex items-center gap-3">
        <div class="text-right text-xs leading-snug text-muted">
          <div>Mano {{ v.handNumber }}</div>
          <div>Ciegas {{ v.blinds.sb | money: 'plain' }} / {{ v.blinds.bb | money: 'plain' }}</div>
        </div>
        <button class="icon-btn !ml-0 text-muted" [attr.aria-label]="sound.muted() ? 'Activar sonido' : 'Silenciar'"
                [attr.aria-pressed]="sound.muted()" (click)="sound.toggleMuted()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M11 5 6 9H3v6h3l5 4z" />
            @if (sound.muted()) {
              <path d="m22 9-6 6M16 9l6 6" />
            } @else {
              <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
            }
          </svg>
        </button>
      </div>
    </header>

    <!--
      Móvil: rivales en filas y tablero debajo.
      Escritorio (lg): mesa ovalada con los rivales alrededor y el tablero en el centro.
    -->
    <div class="arena flex flex-1 flex-col">
      <div class="felt" aria-hidden="true"></div>
      <!-- Historial de la partida, a la derecha de la mesa (solo escritorio). -->
      <app-hand-log class="log" />

      <!-- Rivales, empezando por el que se sienta a tu izquierda. -->
      <section class="opponents grid grid-cols-5 gap-x-1 gap-y-3 pt-4">
        @for (player of opponents(); track player.id; let i = $index, count = $count) {
          <app-seat
            [style.--x]="seatPosition(i, count).x"
            [style.--y]="seatPosition(i, count).y"
            [player]="player"
            [dealer]="player.seat === v.buttonSeat"
            [winner]="winners().has(player.id)"
            [progress]="player.id === v.toAct ? turnProgress() : null"
          />
        }
      </section>

      <!-- Tablero y bote. -->
      <section class="center flex flex-1 flex-col justify-center py-6">
        <div class="grid grid-cols-5 gap-2">
          @for (card of board(); track card ?? 'empty-' + $index) {
            <app-card [card]="card" animate.enter="card-enter" />
          }
        </div>
        <div class="pot mt-3 min-h-14 text-right">
          @if (resultLines().length > 0) {
            @for (line of resultLines(); track $index) {
              <p class="text-lg font-light text-win" animate.enter="fade-enter">{{ line }}</p>
            }
          } @else {
            <p class="text-2xl font-light tabular-nums">{{ v.potTotal | money: 'plain' }}</p>
          }
        </div>
      </section>
    </div>

    <!-- Tus acciones y tu mano. -->
    <section class="bottom flex flex-col gap-4 pb-6">
      <app-action-bar
        class="actions"
        [legal]="v.you?.legal ?? null"
        [stack]="me()?.stack ?? 0"
        [potTotal]="v.potTotal"
        [currentBet]="currentBet()"
        [progress]="turnProgress() ?? 1"
        [pending]="pending()"
        [idleText]="idleText()"
        (act)="act($event)"
      />

      <div class="my-hand grid grid-cols-[1.1fr_1fr] gap-4">
        <div class="relative flex items-end" [class.opacity-40]="me()?.handState === 'folded'">
          @if (v.you?.holeCards; as cards) {
            <app-card class="w-[60%]" [card]="cards[0]" animate.enter="card-enter" />
            <app-card class="-ml-[22%] w-[60%]" [card]="cards[1]" animate.enter="card-enter" />
          }
          @if ((me()?.betThisStreet ?? 0) > 0) {
            <span class="pill absolute -top-3 right-0" animate.enter="fade-enter">
              {{ me()!.betThisStreet | money: 'plain' }}
            </span>
          }
        </div>

        <div class="relative flex flex-col items-center justify-center gap-1 rounded-3xl border-[1.5px] py-4"
             [class.border-line]="!myTurn()" [class.border-white]="myTurn()"
             [class.!border-win]="winners().has(me()?.id ?? '')">
          <span class="h-5 text-sm text-muted">{{ handLabel() }}</span>
          <app-avatar class="h-14 text-5xl" [value]="me()?.avatar ?? ''" />
          <span class="text-2xl font-light tabular-nums">{{ me()?.stack ?? 0 | money: 'plain' }}</span>
          @if (me()?.seat === v.buttonSeat) {
            <span class="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-semibold text-black">D</span>
          }
        </div>
      </div>
    </section>

    @if (toast(); as message) {
      <div class="fixed inset-x-0 top-4 z-40 flex justify-center px-4" animate.enter="fade-enter">
        <p class="rounded-full bg-surface px-5 py-3 text-sm shadow-lg">{{ message }}</p>
      </div>
    }

    <!-- Te has quedado sin fichas y puedes recomprar: panel fijo abajo, sin capa encima de la mesa. -->
    @if (rebuySecondsLeft() !== null) {
      <div class="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div class="w-full max-w-md rounded-3xl border-[1.5px] border-line bg-surface p-5 shadow-2xl" animate.enter="sheet-enter">
          <div class="flex items-baseline justify-between">
            <h2 class="text-xl font-light">Te has quedado sin fichas</h2>
            <span class="text-sm tabular-nums text-muted">{{ rebuySecondsLeft() }} s</span>
          </div>
          <p class="mt-1 text-sm text-muted">{{ rebuyHint() }}</p>
          <div class="mt-5 grid grid-cols-2 gap-3">
            <button class="btn" [disabled]="pending()" (click)="spectate()">Mirar</button>
            <button class="btn btn-primary" [disabled]="pending()" (click)="rebuy()">
              Recomprar {{ v.buyIn | money: 'short' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .felt,
    .log {
      display: none;
    }

    /* Escritorio: mesa ovalada en horizontal. */
    @media (min-width: 1024px) {
      .arena {
        position: relative;
        flex: none;
        height: min(58vh, 34rem);
        margin-block: 3rem 2.5rem;
        margin-right: 11rem;
      }
      .log {
        display: block;
        position: absolute;
        top: 50%;
        right: -11rem;
        width: 9.5rem;
        height: 70%;
        transform: translateY(-50%);
      }
      .felt {
        display: block;
        position: absolute;
        inset: 10% 8%;
        border-radius: 9999px;
        border: 1.5px solid var(--color-line);
        background: radial-gradient(ellipse at center, #111113 0%, #000 72%);
      }
      /* Cada rival se coloca en el borde de la mesa según --x / --y (en %). */
      .opponents {
        position: absolute;
        inset: 0;
        display: block;
        padding: 0;
      }
      .opponents > app-seat {
        position: absolute;
        left: calc(var(--x) * 1%);
        top: calc(var(--y) * 1%);
        width: 7rem;
        transform: translate(-50%, -50%);
      }
      .center {
        position: absolute;
        left: 50%;
        top: 50%;
        width: min(42%, 28rem);
        padding: 0;
        transform: translate(-50%, -50%);
      }
      .pot {
        text-align: center;
      }
      /* Abajo, en horizontal: tu mano a la izquierda y las acciones a la derecha. */
      .bottom {
        display: grid;
        grid-template-columns: minmax(0, 24rem) minmax(0, 1fr);
        align-items: end;
        gap: 3rem;
      }
      .my-hand {
        order: 1;
      }
      .actions {
        order: 2;
        align-self: center;
      }
    }
  `,
  host: { class: 'flex flex-1 flex-col select-none' },
})
export class GameTable {
  private readonly table = inject(TableService);
  private readonly clock = inject(ClockService);
  protected readonly sound = inject(SoundService);

  readonly leave = output<void>();

  protected readonly view = computed(() => this.table.view()!);
  protected readonly me = this.table.me;
  protected readonly pending = signal(false);
  protected readonly toast = signal<string | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly myTurn = computed(() => this.view().toAct === this.me()?.id);

  protected readonly opponents = computed(() => {
    const view = this.view();
    const mySeat = this.me()?.seat ?? 0;
    const distance = (seat: number) => (seat - mySeat + view.maxPlayers) % view.maxPlayers;
    return view.players
      .filter((p) => p.id !== view.you?.id)
      .sort((a, b) => distance(a.seat) - distance(b.seat));
  });

  /**
   * Posición (en %) del rival `index` alrededor de la mesa ovalada de escritorio.
   * Tú ocupas el centro de abajo; los rivales siguen el sentido horario desde tu
   * izquierda: lado izquierdo, parte de arriba y lado derecho.
   */
  protected seatPosition(index: number, total: number): { x: number; y: number } {
    const angle = Math.PI / 2 + (2 * Math.PI * (index + 1)) / (total + 1);
    return { x: 50 + 46 * Math.cos(angle), y: 50 + 44 * Math.sin(angle) };
  }

  protected readonly board = computed<(Card | null)[]>(() =>
    Array.from({ length: BOARD_SIZE }, (_, i) => this.view().board[i] ?? null),
  );

  protected readonly currentBet = computed(() =>
    Math.max(0, ...this.view().players.map((p) => p.betThisStreet)),
  );

  protected readonly turnProgress = computed(() => {
    const view = this.view();
    if (view.turnDeadline === null) return null;
    const remaining = this.table.toLocalTime(view.turnDeadline) - this.clock.now();
    return Math.min(1, Math.max(0, remaining / view.turnTimeoutMs));
  });

  protected readonly handLabel = computed(() => {
    const category = this.view().you?.handCategory;
    return category ? HAND_LABELS[category] : '';
  });

  protected readonly winners = computed(
    () => new Set(this.view().results?.flatMap((result) => result.winners) ?? []),
  );

  protected readonly resultLines = computed(() => {
    const view = this.view();
    const nickname = (id: string) => (id === view.you?.id ? 'Tú' : view.players.find((p) => p.id === id)?.nickname);
    return (view.results ?? []).map((result) => {
      const names = result.winners.map(nickname).join(' y ');
      const verb = result.winners.length > 1 ? 'se reparten' : result.winners[0] === view.you?.id ? 'ganas' : 'gana';
      const hand = result.category ? ` · ${HAND_LABELS[result.category]}` : '';
      return `${names} ${verb} ${formatMoney(result.amount)}${hand}`;
    });
  });

  protected readonly idleText = computed(() => {
    const view = this.view();
    const me = this.me();
    const deciding = view.players.filter((p) => p.deciding && p.id !== me?.id);
    if (deciding.length > 0) {
      return `Esperando a que ${deciding.map((p) => p.nickname).join(' y ')} decida si recompra…`;
    }
    if (me?.status === 'eliminated' && !me.deciding) return 'Estás mirando la partida';
    if (view.results) return 'Siguiente mano en un momento…';
    if (me?.handState === 'folded') return 'Te has retirado de esta mano';
    const actor = view.players.find((p) => p.id === view.toAct);
    return actor ? `Turno de ${actor.nickname}` : '';
  });

  /** Segundos que te quedan para decidir si recompras, o null si no tienes que decidir. */
  protected readonly rebuySecondsLeft = computed(() => {
    const deadline = this.view().you?.rebuyDeadline;
    if (deadline == null) return null;
    return Math.max(0, Math.ceil((this.table.toLocalTime(deadline) - this.clock.now()) / 1000));
  });

  protected readonly rebuyHint = computed(() => {
    const view = this.view();
    const { maxPerPlayer } = view.rebuy;
    const used = this.me()?.rebuys ?? 0;
    const left =
      maxPerPlayer === null
        ? 'Recompras ilimitadas.'
        : maxPerPlayer - used === 1
          ? 'Es tu última recompra.'
          : `Te quedan ${maxPerPlayer - used} recompras.`;
    return `Vuelve con ${formatMoney(view.buyIn)} en la siguiente mano. ${left} Si no eliges, te quedas mirando.`;
  });

  constructor() {
    this.table.events.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((events) => {
      this.sound.playEvents(events, this.me()?.id ?? null);
      for (const event of events) {
        if (event.type === 'blindsIncreased') {
          this.showToast(`Suben las ciegas: ${formatMoney(event.sb)} / ${formatMoney(event.bb)}`);
        }
        if (event.type === 'playerRebought') {
          const who = event.playerId === this.me()?.id ? 'Recompras' : `${this.nickname(event.playerId)} recompra`;
          this.showToast(`${who}: vuelve con ${formatMoney(event.amount)}`);
        }
      }
    });

    // Cada turno se identifica por su hora límite, que es distinta cada vez que te toca.
    let announcedTurn: number | null = null;
    let warnedTurn: number | null = null;

    // Dos notas suaves cuando empieza tu turno.
    effect(() => {
      const deadline = this.myTurn() ? this.view().turnDeadline : null;
      if (deadline !== null && deadline !== announcedTurn) this.sound.play('yourTurn');
      announcedTurn = deadline;
    });

    // Beep-beep cuando se te acaba el tiempo (una sola vez por turno).
    effect(() => {
      const progress = this.turnProgress();
      const deadline = this.view().turnDeadline;
      if (!this.myTurn() || progress === null || deadline === warnedTurn) return;
      if (progress * this.view().turnTimeoutMs <= TIME_WARNING_MS) {
        warnedTurn = deadline;
        this.sound.play('timeWarning');
      }
    });
  }

  protected async act(action: Action): Promise<void> {
    this.pending.set(true);
    const result = await this.table.act(action);
    this.pending.set(false);
    if (!result.ok && result.error !== 'STALE_HAND') this.showToast(errorMessage(result.error));
  }

  protected async rebuy(): Promise<void> {
    this.pending.set(true);
    const result = await this.table.rebuy();
    this.pending.set(false);
    if (!result.ok) this.showToast(errorMessage(result.error));
  }

  protected async spectate(): Promise<void> {
    this.pending.set(true);
    const result = await this.table.spectate();
    this.pending.set(false);
    if (!result.ok) this.showToast(errorMessage(result.error));
  }

  private nickname(playerId: string): string {
    return this.view().players.find((p) => p.id === playerId)?.nickname ?? 'Alguien';
  }

  private showToast(message: string): void {
    clearTimeout(this.toastTimer);
    this.toast.set(message);
    this.toastTimer = setTimeout(() => this.toast.set(null), TOAST_MS);
  }
}
