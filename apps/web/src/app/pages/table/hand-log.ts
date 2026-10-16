import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Card, GameEvent } from '@solo-poker/engine';
import { HAND_LABELS, formatMoney } from '../../core/format';
import { TableService } from '../../core/table.service';

/** Manos que se conservan en el historial (la actual y las anteriores). */
const KEPT_HANDS = 4;
const SUIT_SYMBOLS: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };
const STREET_LABELS: Record<string, string> = { flop: 'Flop', turn: 'Turn', river: 'River' };

type EntryKind = 'hand' | 'action' | 'win';

interface Entry {
  id: number;
  hand: number;
  kind: EntryKind;
  text: string;
}

const cardText = (card: Card) => `${card[0] === 'T' ? '10' : card[0]}${SUIT_SYMBOLS[card[1]!]}`;

/**
 * Historial de la partida (solo escritorio): un "ticker" con lo que va pasando.
 * Se construye con los eventos que llegan mientras estás en la mesa; las entradas
 * antiguas suben y se difuminan por arriba.
 */
@Component({
  selector: 'app-hand-log',
  template: `
    <ol class="list" aria-live="off">
      @for (entry of entries(); track entry.id) {
        <li class="entry" [class]="entry.kind" [class.latest]="entry.id === latestAction()" animate.enter="log-enter">
          {{ entry.text }}
        </li>
      }
    </ol>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      overflow: hidden;
      font-size: 0.625rem;
      line-height: 1.4;
      color: var(--color-muted);
      /* Difuminado largo arriba (lo antiguo se desvanece) y corto abajo. */
      mask-image: linear-gradient(to bottom, transparent 0, #000 45%, #000 85%, transparent 100%);
    }
    .list {
      position: absolute;
      inset-inline: 0;
      bottom: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .hand {
      margin-top: 0.5rem;
      color: #5a5a5e;
    }
    .latest {
      color: #fff;
    }
    .win {
      color: var(--color-win);
    }
    .entry {
      transition: color 600ms ease;
    }
    .log-enter {
      animation: log-enter 350ms ease-out;
    }
    @keyframes log-enter {
      from {
        opacity: 0.3;
        transform: translateY(0.5rem);
      }
    }
  `,
})
export class HandLog {
  private readonly table = inject(TableService);

  protected readonly entries = signal<Entry[]>([]);
  /** La última jugada se resalta en blanco. */
  protected readonly latestAction = computed(
    () => this.entries().filter((entry) => entry.kind === 'action').at(-1)?.id ?? null,
  );
  private nextId = 0;
  private handNumber = 0;
  /** Apuesta más alta de la calle, para distinguir Bet de Raise. */
  private streetBet = 0;
  /** Apodos conocidos: quien abandona la mesa puede no estar ya en la vista. */
  private readonly names = new Map<string, string>();

  constructor() {
    effect(() => {
      for (const player of this.table.view()?.players ?? []) this.names.set(player.id, player.nickname);
    });
    this.table.events.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((events) => {
      const added = events.flatMap((event) => this.describe(event));
      if (added.length === 0) return;
      const oldest = this.handNumber - KEPT_HANDS + 1;
      this.entries.update((list) => [...list, ...added].filter((entry) => entry.hand >= oldest));
    });
  }

  private name(playerId: string): string {
    return playerId === this.table.view()?.you?.id ? 'Tú' : (this.names.get(playerId) ?? 'Alguien');
  }

  private entry(kind: EntryKind, text: string): Entry {
    return { id: this.nextId++, hand: this.handNumber, kind, text };
  }

  private describe(event: GameEvent): Entry[] {
    switch (event.type) {
      case 'handStarted':
        this.handNumber = event.handNumber;
        this.streetBet = 0;
        return [this.entry('hand', `Mano ${event.handNumber}`)];
      case 'blindsPosted':
        this.streetBet = event.bb.amount;
        return [];
      case 'blindsIncreased':
        return [this.entry('hand', `Suben las ciegas: ${formatMoney(event.sb, 'plain')} / ${formatMoney(event.bb, 'plain')}`)];
      case 'streetDealt': {
        this.streetBet = 0;
        const label = STREET_LABELS[event.street];
        return label ? [this.entry('action', `${label}  ${event.cards.map(cardText).join(' ')}`)] : [];
      }
      case 'playerActed':
        return [this.entry('action', `${this.name(event.playerId)}: ${this.actionText(event)}`)];
      case 'turnTimedOut':
        return [this.entry('action', `${this.name(event.playerId)} se queda sin tiempo`)];
      case 'potAwarded': {
        const names = event.winners.map((id) => this.name(id)).join(' y ');
        const you = event.winners.length === 1 && event.winners[0] === this.table.view()?.you?.id;
        const verb = event.winners.length > 1 ? 'se reparten' : you ? 'ganas' : 'gana';
        const hand = event.category ? ` · ${HAND_LABELS[event.category]}` : '';
        return [this.entry('win', `${names} ${verb} ${formatMoney(event.amount)}${hand}`)];
      }
      case 'playerEliminated':
        return [this.entry('action', `${this.name(event.playerId)} se queda sin fichas`)];
      case 'playerRebought':
        return [this.entry('action', `${this.name(event.playerId)} recompra`)];
      case 'playerLeft':
        return [this.entry('action', `${this.name(event.playerId)} abandona la mesa`)];
      default:
        return [];
    }
  }

  private actionText(event: Extract<GameEvent, { type: 'playerActed' }>): string {
    const { action } = event;
    if (action.type === 'fold') return 'Fold';
    if (action.type === 'check') return 'Check';
    if (action.type === 'call') {
      return event.allIn ? `All-in ${formatMoney(event.amount, 'plain')}` : `Call ${formatMoney(event.amount, 'plain')}`;
    }
    const verb = event.allIn ? 'All-in' : this.streetBet === 0 ? 'Bet' : 'Raise';
    this.streetBet = Math.max(this.streetBet, action.to);
    return `${verb} ${formatMoney(action.to, 'plain')}`;
  }
}
