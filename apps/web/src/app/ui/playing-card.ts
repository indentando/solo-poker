import { Component, computed, input } from '@angular/core';
import type { Card } from '@solo-poker/engine';

const SUIT_SYMBOLS = { c: '♣', d: '♦', h: '♥', s: '♠' } as const;

/**
 * Carta boca arriba, o boca abajo (rayas con la ficha "SP") si `card` es null.
 * Ocupa todo el ancho de su contenedor y escala el texto con él.
 */
@Component({
  selector: 'app-card',
  template: `
    @if (card(); as c) {
      <div class="card face" [class.red]="red()" [attr.aria-label]="label()" role="img">
        <span class="rank">{{ rank() }}</span>
        <span class="suit">{{ suit() }}</span>
      </div>
    } @else {
      <div class="card back" aria-hidden="true">
        <div class="stripes"></div>
        <!-- Ficha "SP" del icono, en negro, sobre un hueco blanco en las rayas. -->
        <svg class="chip" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="50" fill="var(--color-card)" />
          <circle cx="50" cy="50" r="45.3" fill="none" stroke="#111" stroke-width="8.8" stroke-dasharray="17.6 10.86" />
          <circle cx="50" cy="50" r="32.7" fill="#111" />
          <g transform="translate(50 50) scale(1.26) translate(-50 -50)" fill="none" stroke="var(--color-card)" stroke-width="4.2">
            <path d="M46.2 46.3C45.6 44.9 44.3 44.1 42.9 44.1C41.1 44.1 39.7 45.3 39.7 46.9C39.7 48.6 41.1 49.3 43 49.8C45.1 50.4 46.5 51.2 46.5 53C46.5 54.8 44.9 55.9 43 55.9C41.3 55.9 39.9 55 39.3 53.6" />
            <path d="M52.6 58V44.1H57C59 44.1 60.4 45.5 60.4 47.6C60.4 49.7 59 51.1 57 51.1H52.6" />
          </g>
        </svg>
      </div>
    }
  `,
  styles: `
    /* El host es el contenedor: así las unidades cqw se miden sobre el ancho de la carta. */
    :host {
      display: block;
      container-type: inline-size;
    }
    .card {
      position: relative;
      aspect-ratio: 5 / 7;
      width: 100%;
      overflow: hidden;
      border-radius: 14cqw;
      background: var(--color-card);
      box-shadow: 0 2px 10px rgb(0 0 0 / 0.35);
    }
    .face {
      color: #111;
    }
    .face.red {
      color: var(--color-suit-red);
    }
    .rank {
      position: absolute;
      top: 8%;
      left: 13%;
      font-size: 42cqw;
      font-weight: 300;
      line-height: 1;
      letter-spacing: -0.04em;
    }
    .suit {
      position: absolute;
      bottom: 9%;
      left: 13%;
      font-size: 32cqw;
      line-height: 1;
    }
    .stripes {
      position: absolute;
      inset: 9%;
      border-radius: 6cqw;
      background: repeating-linear-gradient(-45deg, #111 0 3.5cqw, transparent 3.5cqw 10cqw);
    }
    .chip {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 54%;
      translate: -50% -50%;
    }
  `,
})
export class PlayingCard {
  readonly card = input<Card | null>(null);

  protected readonly rank = computed(() => {
    const rank = this.card()?.[0];
    return rank === 'T' ? '10' : rank;
  });
  protected readonly suit = computed(() => {
    const suit = this.card()?.[1] as keyof typeof SUIT_SYMBOLS | undefined;
    return suit ? SUIT_SYMBOLS[suit] : '';
  });
  protected readonly red = computed(() => /[dh]$/.test(this.card() ?? ''));
  protected readonly label = computed(() => `${this.rank()}${this.suit()}`);
}
