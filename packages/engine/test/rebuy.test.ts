import { describe, expect, it } from 'vitest';
import {
  applyAction,
  computeLedger,
  declineRebuy,
  getLegalActions,
  getPlayerView,
  rebuy,
  removePlayer,
  settleUp,
  standardBlindStructure,
  startHand,
  type Action,
  type Card,
  type GameEvent,
  type RebuyRules,
  type TableState,
} from '../src';
import { expectOk, seededRng, setupTable, stackDeck, stacks } from './helpers';

const RULES: RebuyRules = { maxPerPlayer: 1, untilMinutes: 60, decisionMs: 20_000 };

/**
 * Heads-up: los dos van all-in, p0 gana con ases y p1 se queda sin fichas.
 * Funciona en cualquier mano (el botón rota) y todo ocurre en el instante `now`.
 */
function bust(state: TableState, now = 0) {
  const p0Cards: [Card, Card] = ['As', 'Ad'];
  const p1Cards: [Card, Card] = ['7h', '2c'];
  // Se reparte empezando a la izquierda del botón; en la primera mano el botón no se mueve.
  const nextButton = state.handNumber === 0 ? state.buttonSeat : 1 - state.buttonSeat;
  const holes: [Card, Card][] = nextButton === 0 ? [p1Cards, p0Cards] : [p0Cards, p1Cards];
  const deck = stackDeck(holes, ['3h', '8d', '9c', 'Js', '4s']);

  let s = expectOk(startHand(state, { rng: seededRng(1), now, deck })).state;
  let events: GameEvent[] = [];
  while (!s.hand!.finished) {
    const id = s.hand!.toAct!;
    const legal = getLegalActions(s, id)!;
    const action: Action = legal.raise
      ? { type: 'raise', to: legal.raise.max }
      : legal.canCheck
        ? { type: 'check' }
        : { type: 'call' };
    ({ state: s, events } = expectOk(applyAction(s, id, action, now)));
  }
  return { state: s, events };
}

describe('recompras', () => {
  it('sin recompras, quedarse sin fichas termina la partida como antes', () => {
    const { state, events } = bust(setupTable(2));
    expect(events).toContainEqual({ type: 'playerEliminated', playerId: 'p1', canRebuy: false });
    expect(state.status).toBe('finished');
  });

  it('con recompras, la partida espera a que el eliminado decida', () => {
    const { state, events } = bust(setupTable(2, { rebuy: RULES }), 1_000);
    expect(events).toContainEqual({ type: 'playerEliminated', playerId: 'p1', canRebuy: true });
    expect(state.status).toBe('playing');
    expect(state.players[1]!.rebuyDeadline).toBe(21_000);
    expect(getPlayerView(state, 'p1').you!.rebuyDeadline).toBe(21_000);
    // Mientras decide no se reparte la siguiente mano.
    expect(startHand(state, { rng: seededRng(2), now: 2_000 })).toEqual({ ok: false, error: 'WAITING_FOR_REBUY' });
  });

  it('recomprar devuelve al jugador con una entrada nueva', () => {
    const busted = bust(setupTable(2, { rebuy: RULES })).state;
    const { state, events } = expectOk(rebuy(busted, 'p1', 5_000));

    expect(events).toEqual([{ type: 'playerRebought', playerId: 'p1', amount: 1000, rebuys: 1 }]);
    expect(state.players[1]).toMatchObject({ status: 'active', stack: 1000, rebuys: 1, rebuyDeadline: null });
    // La siguiente mano ya se puede repartir y p1 juega.
    const next = expectOk(startHand(state, { rng: seededRng(2), now: 6_000 })).state;
    expect(next.hand!.order).toContain('p1');
  });

  it('no recomprar (o agotar el plazo) termina la partida si no queda nadie más', () => {
    const busted = bust(setupTable(2, { rebuy: RULES })).state;
    const { state, events } = expectOk(declineRebuy(busted, 'p1', 25_000));
    expect(events).toContainEqual({ type: 'gameOver', winnerId: 'p0' });
    expect(state.status).toBe('finished');
    expect(state.finishedAt).toBe(25_000);
  });

  it('respeta el máximo de recompras por jugador', () => {
    let s = bust(setupTable(2, { rebuy: RULES })).state;
    s = expectOk(rebuy(s, 'p1', 1_000)).state;
    const { state, events } = bust(s, 2_000);
    // Ya gastó su única recompra.
    expect(events).toContainEqual({ type: 'playerEliminated', playerId: 'p1', canRebuy: false });
    expect(state.status).toBe('finished');
    expect(rebuy(state, 'p1', 3_000)).toEqual({ ok: false, error: 'GAME_NOT_PLAYING' });
  });

  it('cierra las recompras pasados los minutos indicados', () => {
    const { events } = bust(setupTable(2, { rebuy: RULES }), 61 * 60_000);
    expect(events).toContainEqual({ type: 'playerEliminated', playerId: 'p1', canRebuy: false });
  });

  it('las recompras ilimitadas y sin límite de tiempo no se cierran', () => {
    let s = setupTable(2, { rebuy: { maxPerPlayer: null, untilMinutes: null, decisionMs: 20_000 } });
    for (let i = 0; i < 5; i++) {
      s = bust(s, i * 3_600_000).state;
      s = expectOk(rebuy(s, 'p1', i * 3_600_000 + 1)).state;
    }
    expect(s.players[1]!.rebuys).toBe(5);
  });

  it('solo se puede recomprar mientras se decide', () => {
    const s = setupTable(2, { rebuy: RULES });
    expect(rebuy(s, 'p1', 0)).toEqual({ ok: false, error: 'REBUY_NOT_ALLOWED' });
  });

  it('irse mientras se decide cuenta como no recomprar', () => {
    const busted = bust(setupTable(2, { rebuy: RULES })).state;
    const { state, events } = expectOk(removePlayer(busted, 'p1', 3_000));
    expect(events).toContainEqual({ type: 'rebuyDeclined', playerId: 'p1' });
    expect(state.status).toBe('finished');
  });
});

describe('partidas aleatorias con recompras', () => {
  it.each(Array.from({ length: 20 }, (_, i) => i))(
    'semilla %i: las fichas cuadran contando las recompras y la partida termina',
    (seed) => {
      const rng = seededRng(seed);
      const players = 2 + (seed % 4);
      const blinds = { ...standardBlindStructure(1000), increaseEvery: { type: 'hands' as const, value: 4 } };
      let s = setupTable(players, { blindStructure: blinds, rebuy: { ...RULES, maxPerPlayer: 2 } });
      let now = 0;

      const chips = () => {
        const hand = s.hand;
        const inPot =
          hand && !hand.finished ? Object.values(hand.seats).reduce((sum, x) => sum + x.totalContributed, 0) : 0;
        return s.players.reduce((sum, p) => sum + p.stack, 0) + inPot;
      };
      const paidIn = () => s.players.reduce((sum, p) => sum + 1000 * (1 + p.rebuys), 0);

      for (let hands = 0; s.status === 'playing'; hands++) {
        expect(hands).toBeLessThan(2000);
        now += 60_000;
        // Los que están decidiendo: unos recompran y otros no.
        for (const p of s.players.filter((x) => x.rebuyDeadline !== null)) {
          s = expectOk(rng(2) === 0 ? rebuy(s, p.id, now) : declineRebuy(s, p.id, now)).state;
        }
        if (s.status !== 'playing') break;

        s = expectOk(startHand(s, { rng, now })).state;
        while (!s.hand!.finished) {
          const id = s.hand!.toAct!;
          const legal = getLegalActions(s, id)!;
          const roll = rng(100);
          const action: Action =
            legal.raise && roll < 25
              ? { type: 'raise', to: legal.raise.min + rng(legal.raise.max - legal.raise.min + 1) }
              : !legal.canCheck && roll < 40
                ? { type: 'fold' }
                : legal.canCheck
                  ? { type: 'check' }
                  : { type: 'call' };
          s = expectOk(applyAction(s, id, action, now)).state;
          expect(chips()).toBe(paidIn());
        }
      }

      expect(s.status).toBe('finished');
      const ledger = computeLedger(s.players.map((p) => ({ id: p.id, stack: p.stack, rebuys: p.rebuys })), 1000);
      expect(ledger.reduce((sum, e) => sum + e.net, 0)).toBe(0);
    },
  );
});

describe('resumen de cuentas', () => {
  it('calcula lo invertido, lo final y el balance de cada uno', () => {
    let s = bust(setupTable(2, { rebuy: RULES })).state;
    s = expectOk(rebuy(s, 'p1', 1_000)).state;
    s = bust(s, 2_000).state;

    expect(stacks(s)).toEqual([3000, 0]);
    expect(computeLedger(s.players.map((p) => ({ id: p.id, stack: p.stack, rebuys: p.rebuys })), 1000)).toEqual([
      { playerId: 'p0', paidIn: 1000, final: 3000, net: 2000, rebuys: 0 },
      { playerId: 'p1', paidIn: 2000, final: 0, net: -2000, rebuys: 1 },
    ]);
  });

  it('propone los pagos para saldar cuentas', () => {
    const ledger = computeLedger(
      [
        { id: 'ana', stack: 3500, rebuys: 0 },
        { id: 'bea', stack: 0, rebuys: 1 },
        { id: 'cris', stack: 500, rebuys: 0 },
        { id: 'dani', stack: 1000, rebuys: 0 },
      ],
      1000,
    );
    // Ana +2500, Dani ±0, Cris −500, Bea −2000: suman cero.
    expect(ledger.reduce((sum, e) => sum + e.net, 0)).toBe(0);
    expect(settleUp(ledger)).toEqual([
      { from: 'bea', to: 'ana', amount: 2000 },
      { from: 'cris', to: 'ana', amount: 500 },
    ]);
  });

  it('nadie paga nada si todos quedan como empezaron', () => {
    const ledger = computeLedger(
      [
        { id: 'a', stack: 1000, rebuys: 0 },
        { id: 'b', stack: 1000, rebuys: 0 },
      ],
      1000,
    );
    expect(settleUp(ledger)).toEqual([]);
  });
});
