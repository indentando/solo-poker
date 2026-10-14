import type { BlindStructure, Cents } from './types';

const BB_MULTIPLIERS = [1, 2, 3, 4, 6, 8, 10, 15, 20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500];

/**
 * Estructura estándar: se empieza con 100 ciegas grandes y suben cada 10 minutos.
 * Con un buy-in de 10 € el primer nivel es 0,05 € / 0,10 €.
 */
export function standardBlindStructure(buyIn: Cents): BlindStructure {
  // La ciega grande siempre par, para que la pequeña sea un número entero de céntimos.
  const baseBb = Math.max(2, Math.round(buyIn / 100 / 2) * 2);
  return {
    levels: BB_MULTIPLIERS.map((m) => ({ sb: (baseBb * m) / 2, bb: baseBb * m })),
    increaseEvery: { type: 'minutes', value: 10 },
  };
}
