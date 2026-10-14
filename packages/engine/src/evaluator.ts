import { rankValue, suitOf } from './cards';
import type { Card, HandCategory } from './types';

const CATEGORIES: readonly HandCategory[] = [
  'highCard',
  'pair',
  'twoPair',
  'threeOfAKind',
  'straight',
  'flush',
  'fullHouse',
  'fourOfAKind',
  'straightFlush',
];

export interface HandValue {
  category: HandCategory;
  /** Mayor puntuación = mejor mano. Manos con igual puntuación empatan. */
  score: number;
  cards: Card[];
}

/** Codifica categoría + kickers en base 16: compara manos con un simple `>`. */
function encode(categoryIndex: number, kickers: number[]): number {
  let score = categoryIndex;
  for (let i = 0; i < 5; i++) score = score * 16 + (kickers[i] ?? 0);
  return score;
}

/** Recibe valores únicos ordenados de mayor a menor. Devuelve la carta alta de la escalera, o 0. */
function straightHigh(values: number[]): number {
  if (values.length !== 5) return 0;
  if (values.every((v, i) => i === 0 || values[i - 1]! - v === 1)) return values[0]!;
  // La rueda: A-2-3-4-5, donde el As cuenta como 1.
  if (values.join() === '14,5,4,3,2') return 5;
  return 0;
}

/** Evalúa de 1 a 5 cartas. Escalera y color solo cuentan con exactamente 5. */
function evaluateUpToFive(cards: Card[]): HandValue {
  const counts = new Map<number, number>();
  for (const card of cards) {
    const value = rankValue(card);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  // Agrupa por (repeticiones desc, valor desc): el orden natural de los kickers.
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const kickers = groups.map(([value]) => value);
  const isFlush = cards.length === 5 && cards.every((c) => suitOf(c) === suitOf(cards[0]!));
  const straight = straightHigh(kickers);

  const top = groups[0]![1];
  const second = groups[1]?.[1] ?? 0;

  let category: number;
  let finalKickers = kickers;
  if (straight && isFlush) {
    category = 8;
    finalKickers = [straight];
  } else if (top === 4) category = 7;
  else if (top === 3 && second === 2) category = 6;
  else if (isFlush) category = 5;
  else if (straight) {
    category = 4;
    finalKickers = [straight];
  } else if (top === 3) category = 3;
  else if (top === 2 && second === 2) category = 2;
  else if (top === 2) category = 1;
  else category = 0;

  return { category: CATEGORIES[category]!, score: encode(category, finalKickers), cards };
}

function* combinations<T>(items: T[], k: number, start = 0, picked: T[] = []): Generator<T[]> {
  if (picked.length === k) {
    yield [...picked];
    return;
  }
  for (let i = start; i <= items.length - (k - picked.length); i++) {
    picked.push(items[i]!);
    yield* combinations(items, k, i + 1, picked);
    picked.pop();
  }
}

/** Mejor mano posible con 1 a 7 cartas (cartas propias + comunitarias). */
export function evaluateHand(cards: Card[]): HandValue {
  if (cards.length === 0) throw new Error('evaluateHand: no cards');
  if (cards.length <= 5) return evaluateUpToFive(cards);

  let best: HandValue | null = null;
  for (const combo of combinations(cards, 5)) {
    const value = evaluateUpToFive(combo);
    if (!best || value.score > best.score) best = value;
  }
  return best!;
}
