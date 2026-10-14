import { Component, computed, input } from '@angular/core';
import type { Card } from '@solo-poker/engine';

const SUIT_SYMBOLS = { c: '♣', d: '♦', h: '♥', s: '♠' } as const;

/**
 * Carta boca arriba, o boca abajo (rayas) si `card` es null.
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
      <div class="card back" aria-hidden="true"><div class="stripes"></div></div>
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
