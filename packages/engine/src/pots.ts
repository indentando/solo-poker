import type { Cents, PlayerId } from './types';

export interface Contribution {
  id: PlayerId;
  amount: Cents;
  folded: boolean;
}

export interface Pot {
  amount: Cents;
  eligible: PlayerId[];
}

/**
 * Reparte las aportaciones en bote principal + side pots.
 *
 * Cada nivel distinto de aportación de un jugador no retirado abre un bote,
 * que solo pueden ganar quienes llegaron a ese nivel. Las fichas de los
 * retirados cuentan para los botes, pero ellos no pueden ganarlos.
 */
export function computePots(contributions: Contribution[]): Pot[] {
  const levels = [
    ...new Set(contributions.filter((c) => !c.folded && c.amount > 0).map((c) => c.amount)),
  ].sort((a, b) => a - b);

  const pots: Pot[] = [];
  let previous = 0;
  for (const level of levels) {
    const amount = contributions.reduce(
      (sum, c) => sum + Math.min(c.amount, level) - Math.min(c.amount, previous),
      0,
    );
    const eligible = contributions.filter((c) => !c.folded && c.amount >= level).map((c) => c.id);
    pots.push({ amount, eligible });
    previous = level;
  }

  // Lo que un retirado puso por encima del nivel más alto en disputa va al último bote.
  const leftover = contributions.reduce((sum, c) => sum + Math.max(0, c.amount - previous), 0);
  if (leftover > 0 && pots.length > 0) pots[pots.length - 1]!.amount += leftover;

  return pots;
}

/** Reparte un bote entre `winners` ganadores. Los céntimos sobrantes van a los primeros. */
export function splitAmount(amount: Cents, winners: number): Cents[] {
  const base = Math.floor(amount / winners);
  const remainder = amount - base * winners;
  return Array.from({ length: winners }, (_, i) => base + (i < remainder ? 1 : 0));
}
