import { Component, computed, input } from '@angular/core';
import type { PlayerView } from '@solo-poker/engine';
import { ACTION_LABELS, MoneyPipe } from '../core/format';
import { Avatar } from './avatar';
import { PlayingCard } from './playing-card';

type SeatPlayer = PlayerView['players'][number];

const RING_RADIUS = 30;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** Un rival en la fila superior: avatar, nombre, stack y su apuesta en la calle. */
@Component({
  selector: 'app-seat',
  imports: [MoneyPipe, PlayingCard, Avatar],
  template: `
    <div class="relative" [class.opacity-35]="dimmed()">
      <div class="avatar" [class.winner]="winner()">
        <app-avatar [value]="player().avatar" />
        @if (actionLabel(); as label) {
          <span class="action">{{ label }}</span>
        }
      </div>
      @if (progress() !== null) {
        <svg class="turn-ring" viewBox="0 0 68 68" aria-hidden="true">
          <circle cx="34" cy="34" [attr.r]="radius" fill="none" stroke-width="2.5"
                  [attr.stroke]="(progress() ?? 0) < 0.25 ? 'var(--color-suit-red)' : '#fff'"
                  [attr.stroke-dasharray]="ringLength"
                  [attr.stroke-dashoffset]="ringLength * (1 - (progress() ?? 0))" />
        </svg>
      }
      @if (dealer()) {
        <span class="dealer" aria-label="Dealer">D</span>
      }
      @if (!player().connected && player().status === 'active') {
        <span class="offline" title="Desconectado">âš¡</span>
      }
    </div>

    <div class="mt-2 w-full truncate text-center text-[13px] text-white/70" [class.opacity-35]="dimmed()">
      {{ player().nickname }}
    </div>
    <div class="text-center text-[15px] tabular-nums" [class.opacity-35]="dimmed()">
      @if (player().status === 'eliminated') {
        <span class="text-muted">Fuera</span>
      } @else {
        {{ player().stack | money: 'plain' }}
      }
    </div>

    <div class="mt-2 flex h-9 items-center justify-center">
      @if (player().holeCards; as cards) {
        <div class="flex w-14 gap-0.5" animate.enter="card-enter">
          <app-card class="flex-1" [card]="cards[0]" />
          <app-card class="flex-1" [card]="cards[1]" />
        </div>
      } @else if (player().betThisStreet > 0) {
        <span class="pill" animate.enter="fade-enter">{{ player().betThisStreet | money: 'plain' }}</span>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      min-width: 0;
      flex-direction: column;
      align-items: center;
    }
    .avatar {
      position: relative;
      display: flex;
      height: 3.5rem;
      width: 3.5rem;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      border-radius: 9999px;
      background: var(--color-surface);
      font-size: 2rem;
      transition: box-shadow 200ms;
    }
    .avatar.winner {
      box-shadow: 0 0 0 2.5px var(--color-win);
    }
    .action {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgb(0 0 0 / 0.55);
      font-size: 0.875rem;
      color: #fff;
    }
    .turn-ring {
      position: absolute;
      inset: -6px;
      height: calc(100% + 12px);
      width: calc(100% + 12px);
      transform: rotate(-90deg);
    }
    .turn-ring circle {
      transition: stroke-dashoffset 250ms linear;
    }
    .dealer {
      position: absolute;
      right: -4px;
      bottom: -4px;
      display: flex;
      height: 1.5rem;
      width: 1.5rem;
      align-items: center;
      justify-content: center;
      border-radius: 9999px;
      border: 2px solid #000;
      background: #fff;
      font-size: 0.75rem;
      font-weight: 600;
      color: #000;
    }
    .offline {
      position: absolute;
      left: -4px;
      top: -4px;
      font-size: 0.875rem;
    }
  `,
})
export class Seat {
  readonly player = input.required<SeatPlayer>();
  readonly dealer = input(false);
  readonly winner = input(false);
  /** Tiempo de turno restante (1 â†’ 0), o null si no le toca. */
  readonly progress = input<number | null>(null);

  protected readonly radius = RING_RADIUS;
  protected readonly ringLength = RING_LENGTH;
  protected readonly dimmed = computed(
    () => this.player().status === 'eliminated' || this.player().handState === 'folded',
  );
  protected readonly actionLabel = computed(() => {
    const player = this.player();
    if (player.handState === 'allIn') return 'All-in';
    return player.lastAction ? ACTION_LABELS[player.lastAction] : null;
  });
}
