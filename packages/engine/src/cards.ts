import type { Card, Rank, Rng, Suit } from './types';

export const RANKS: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const SUITS: readonly Suit[] = ['c', 'd', 'h', 's'];

/** Valor numérico del rango: 2..14 (el As vale 14). */
export function rankValue(card: Card): number {
  return RANKS.indexOf(card[0] as Rank) + 2;
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit;
}

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => `${rank}${suit}` as Card));
}

/** Fisher-Yates. Devuelve una copia barajada. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
