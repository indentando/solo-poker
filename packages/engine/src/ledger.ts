import type { Cents, PlayerId } from './types';

/*
 * Resumen de cuentas al final de la partida: cuánto puso cada jugador
 * (entrada + recompras), con cuánto acabó y quién tiene que pagar a quién.
 */

export interface LedgerEntry {
  playerId: PlayerId;
  /** Entrada más recompras. */
  paidIn: Cents;
  /** Fichas al final (o con las que se fue, si abandonó). */
  final: Cents;
  /** final − paidIn: positivo si gana, negativo si pierde. */
  net: Cents;
  rebuys: number;
}

export interface Payment {
  from: PlayerId;
  to: PlayerId;
  amount: Cents;
}

export function computeLedger(
  players: { id: PlayerId; stack: Cents; rebuys: number }[],
  buyIn: Cents,
): LedgerEntry[] {
  return players
    .map((p) => {
      const paidIn = buyIn * (1 + p.rebuys);
      return { playerId: p.id, paidIn, final: p.stack, net: p.stack - paidIn, rebuys: p.rebuys };
    })
    .sort((a, b) => b.net - a.net);
}

/**
 * Pagos para saldar cuentas con el menor número de transferencias razonable:
 * quien más debe paga primero a quien más tiene que cobrar.
 */
export function settleUp(ledger: LedgerEntry[]): Payment[] {
  const debtors = ledger.filter((e) => e.net < 0).map((e) => ({ id: e.playerId, left: -e.net }));
  const creditors = ledger.filter((e) => e.net > 0).map((e) => ({ id: e.playerId, left: e.net }));
  debtors.sort((a, b) => b.left - a.left);
  creditors.sort((a, b) => b.left - a.left);

  const payments: Payment[] = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d]!;
    const creditor = creditors[c]!;
    const amount = Math.min(debtor.left, creditor.left);
    payments.push({ from: debtor.id, to: creditor.id, amount });
    debtor.left -= amount;
    creditor.left -= amount;
    if (debtor.left === 0) d++;
    if (creditor.left === 0) c++;
  }
  return payments;
}
