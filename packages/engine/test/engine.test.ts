import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  applyAction,
  createTable,
  getLegalActions,
  getPlayerView,
  handleTimeout,
  removePlayer,
  standardBlindStructure,
  startGame,
  startHand,
  type Action,
  type TableState,
} from '../src';
import {
  DEFAULT_BLINDS,
  act,
  actWithEvents,
  checkDown,
  deal,
  expectOk,
  seededRng,
  setupTable,
  stackDeck,
  stacks,
} from './helpers';

describe('mesa y sala de espera', () => {
  const config = { id: 'T', maxPlayers: 2, buyIn: 1000, blindStructure: DEFAULT_BLINDS, turnTimeoutMs: 30_000 };

  it('asigna asientos y el buy-in como stack', () => {
    let s = createTable(config);
    s = expectOk(addPlayer(s, { id: 'a', nickname: 'Ana', avatar: 'e:🦊' })).state;
    s = expectOk(addPlayer(s, { id: 'b', nickname: 'Bea', avatar: 'e:🐼' })).state;
    expect(s.players.map((p) => [p.seat, p.stack])).toEqual([
      [0, 1000],
      [1, 1000],
    ]);
  });

  it('rechaza mesa llena, nicknames repetidos o vacíos', () => {
    let s = createTable(config);
    s = expectOk(addPlayer(s, { id: 'a', nickname: 'Ana', avatar: 'e:🦊' })).state;
    expect(addPlayer(s, { id: 'b', nickname: ' ana ', avatar: 'e:🐼' })).toEqual({ ok: false, error: 'NICKNAME_TAKEN' });
    expect(addPlayer(s, { id: 'b', nickname: '   ', avatar: 'e:🐼' })).toEqual({ ok: false, error: 'INVALID_NICKNAME' });
    s = expectOk(addPlayer(s, { id: 'b', nickname: 'Bea', avatar: 'e:🐼' })).state;
    expect(addPlayer(s, { id: 'c', nickname: 'Cris', avatar: 'e:🐨' })).toEqual({ ok: false, error: 'TABLE_FULL' });
  });

  it('no permite repetir icono en la misma mesa', () => {
    let s = createTable(config);
    s = expectOk(addPlayer(s, { id: 'a', nickname: 'Ana', avatar: 'e:🦊' })).state;
    expect(addPlayer(s, { id: 'b', nickname: 'Bea', avatar: 'e:🦊' })).toEqual({ ok: false, error: 'AVATAR_TAKEN' });
    expect(addPlayer(s, { id: 'b', nickname: 'Bea', avatar: '' })).toEqual({ ok: false, error: 'INVALID_AVATAR' });
  });

  it('abandonar en la sala de espera libera el asiento', () => {
    let s = createTable(config);
    s = expectOk(addPlayer(s, { id: 'a', nickname: 'Ana', avatar: 'e:🦊' })).state;
    s = expectOk(removePlayer(s, 'a', 0)).state;
    expect(s.players).toEqual([]);
  });

  it('no empieza con menos de dos jugadores', () => {
    let s = createTable(config);
    s = expectOk(addPlayer(s, { id: 'a', nickname: 'Ana', avatar: 'e:🦊' })).state;
    expect(startGame(s, () => 0, 0)).toEqual({ ok: false, error: 'NOT_ENOUGH_PLAYERS' });
  });
});

describe('ciegas y orden de acción', () => {
  it('heads-up: el botón pone la ciega pequeña y habla primero preflop', () => {
    let s = deal(setupTable(2)).state;
    const hand = s.hand!;
    expect([hand.buttonId, hand.sbId, hand.bbId]).toEqual(['p0', 'p0', 'p1']);
    expect(stacks(s)).toEqual([995, 990]);
    expect(hand.toAct).toBe('p0');

    s = act(s, { type: 'call' });
    expect(s.hand!.toAct).toBe('p1');
    expect(getLegalActions(s, 'p1')!.canCheck).toBe(true);

    // Postflop habla primero la ciega grande.
    s = act(s, { type: 'check' });
    expect(s.hand!.street).toBe('flop');
    expect(s.hand!.board).toHaveLength(3);
    expect(s.hand!.toAct).toBe('p1');
  });

  it('3 jugadores: SB y BB a la izquierda del botón, habla el siguiente', () => {
    const s = deal(setupTable(3)).state;
    const hand = s.hand!;
    expect([hand.buttonId, hand.sbId, hand.bbId, hand.toAct]).toEqual(['p0', 'p1', 'p2', 'p0']);
  });

  it('el botón rota entre manos', () => {
    let s = deal(setupTable(3)).state;
    s = act(s, { type: 'fold' });
    s = act(s, { type: 'fold' });
    s = deal(s).state;
    expect([s.hand!.buttonId, s.hand!.sbId, s.hand!.bbId]).toEqual(['p1', 'p2', 'p0']);
  });

  it('las ciegas suben al empezar la mano siguiente', () => {
    let s = deal(
      setupTable(2, { blindStructure: { ...DEFAULT_BLINDS, increaseEvery: { type: 'hands', value: 1 } } }),
    ).state;
    s = act(s, { type: 'fold' });
    expect(stacks(s)).toEqual([995, 1005]);

    const { state, events } = deal(s);
    expect(events).toContainEqual({ type: 'blindsIncreased', level: 1, sb: 10, bb: 20 });
    // Ahora el botón es p1 y paga la pequeña de 10; p0 la grande de 20.
    expect(stacks(state)).toEqual([975, 995]);
  });

  it('las ciegas por minutos solo suben cuando pasa el tiempo', () => {
    const blinds = { ...DEFAULT_BLINDS, increaseEvery: { type: 'minutes' as const, value: 10 } };
    let s = expectOk(startHand(setupTable(2, { blindStructure: blinds }), { rng: seededRng(1), now: 0 })).state;
    s = act(s, { type: 'fold' });
    s = expectOk(startHand(s, { rng: seededRng(2), now: 5 * 60_000 })).state;
    expect(s.blindLevel).toBe(0);
    s = act(s, { type: 'fold' });
    s = expectOk(startHand(s, { rng: seededRng(3), now: 10 * 60_000 })).state;
    expect(s.blindLevel).toBe(1);
  });
});

describe('acciones', () => {
  it('rechaza actuar fuera de turno', () => {
    const s = deal(setupTable(3)).state;
    expect(applyAction(s, 'p1', { type: 'fold' }, 0)).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
  });

  it('no se puede pasar si hay apuesta, ni igualar si no la hay', () => {
    let s = deal(setupTable(2)).state;
    expect(applyAction(s, 'p0', { type: 'check' }, 0)).toEqual({ ok: false, error: 'ILLEGAL_ACTION' });
    s = act(s, { type: 'call' });
    expect(applyAction(s, 'p1', { type: 'call' }, 0)).toEqual({ ok: false, error: 'ILLEGAL_ACTION' });
  });

  it('valida la subida mínima', () => {
    let s = deal(setupTable(3)).state;
    expect(getLegalActions(s, 'p0')!.raise).toEqual({ min: 20, max: 1000 });
    expect(applyAction(s, 'p0', { type: 'raise', to: 15 }, 0)).toEqual({ ok: false, error: 'INVALID_AMOUNT' });

    s = act(s, { type: 'raise', to: 50 });
    // La subida fue de 40, así que la siguiente debe ser al menos hasta 90.
    expect(getLegalActions(s, 'p1')!.raise!.min).toBe(90);
  });

  it('un all-in corto no reabre la acción a quien ya habló', () => {
    let s = deal(setupTable(3, { stacks: [1000, 130, 1000] })).state;
    s = act(s, { type: 'raise', to: 100 }); // p0
    // p1 solo tiene 130 en total: su all-in no llega a la subida mínima (190).
    expect(getLegalActions(s, 'p1')!.raise).toEqual({ min: 130, max: 130 });
    s = act(s, { type: 'raise', to: 130 }); // p1 all-in

    // p2 aún no había hablado: puede subir.
    expect(getLegalActions(s, 'p2')!.raise!.min).toBe(220);
    s = act(s, { type: 'call' }); // p2

    // p0 ya había hablado y el all-in fue corto: solo puede igualar o retirarse.
    const legal = getLegalActions(s, 'p0')!;
    expect(legal.raise).toBeNull();
    expect(legal.callAmount).toBe(30);
  });

  it('si todos se retiran gana el último, y se le devuelve lo no igualado', () => {
    let s = deal(setupTable(3)).state;
    s = act(s, { type: 'raise', to: 30 });
    s = act(s, { type: 'fold' });
    const { state, events } = actWithEvents(s, { type: 'fold' });

    expect(events).toContainEqual({ type: 'uncalledReturned', playerId: 'p0', amount: 20 });
    expect(state.hand!.results).toEqual([{ amount: 25, winners: ['p0'], category: null }]);
    expect(stacks(state)).toEqual([1015, 995, 990]);
  });

  it('el timeout pasa si puede y si no se retira', () => {
    let s = deal(setupTable(2)).state;
    s = act(s, { type: 'call' });
    const checked = expectOk(handleTimeout(s, 0));
    expect(checked.events[0]).toEqual({ type: 'turnTimedOut', playerId: 'p1' });
    expect(checked.state.hand!.street).toBe('flop');

    const s2 = deal(setupTable(2)).state;
    const folded = expectOk(handleTimeout(s2, 0)).state;
    expect(folded.hand!.finished).toBe(true);
    expect(stacks(folded)).toEqual([995, 1005]);
  });

  it('fija el límite de tiempo del turno', () => {
    const s = expectOk(startHand(setupTable(2), { rng: seededRng(1), now: 1000 })).state;
    expect(s.hand!.turnDeadline).toBe(31_000);
  });
});

describe('showdown', () => {
  it('reparte side pots entre varios all-in', () => {
    // Orden de reparto: p1, p2, p0 (empieza a la izquierda del botón).
    const deck = stackDeck(
      [
        ['As', 'Ad'],
        ['Ks', 'Kd'],
        ['7h', '2c'],
      ],
      ['3h', '8d', '9c', 'Js', '4s'],
    );
    let s = deal(setupTable(3, { stacks: [1000, 100, 300] }), deck).state;
    s = act(s, { type: 'raise', to: 1000 }); // p0 all-in
    s = act(s, { type: 'call' }); // p1 all-in por 100
    const { state, events } = actWithEvents(s, { type: 'call' }); // p2 all-in por 300

    expect(events).toContainEqual({ type: 'uncalledReturned', playerId: 'p0', amount: 700 });
    expect(state.hand!.board).toHaveLength(5);
    expect(state.hand!.results).toEqual([
      { amount: 300, winners: ['p1'], category: 'pair' },
      { amount: 400, winners: ['p2'], category: 'pair' },
    ]);
    expect(stacks(state)).toEqual([700, 300, 400]);
  });

  it('en un empate el céntimo sobrante va al primero a la izquierda del botón', () => {
    const deck = stackDeck(
      [
        ['2c', '3d'],
        ['4c', '5d'],
        ['2h', '3s'],
      ],
      ['Ts', 'Jh', 'Qd', 'Kc', 'Ah'],
    );
    let s = deal(setupTable(3), deck).state;
    s = act(s, { type: 'call' }); // p0
    s = act(s, { type: 'fold' }); // p1 deja sus 5 en el bote
    s = checkDown(s);

    expect(s.hand!.results).toEqual([{ amount: 25, winners: ['p2', 'p0'], category: 'straight' }]);
    expect(stacks(s)).toEqual([1002, 995, 1003]);
  });

  it('elimina al que se queda sin fichas y termina la partida', () => {
    const deck = stackDeck(
      [
        ['7h', '2c'],
        ['As', 'Ad'],
      ],
      ['3h', '8d', '9c', 'Js', '4s'],
    );
    let s = deal(setupTable(2, { stacks: [1000, 50] }), deck).state;
    s = act(s, { type: 'raise', to: 1000 });
    const { state, events } = actWithEvents(s, { type: 'call' });

    expect(events).toContainEqual({ type: 'playerEliminated', playerId: 'p1' });
    expect(events).toContainEqual({ type: 'gameOver', winnerId: 'p0' });
    expect(state.status).toBe('finished');
    expect(stacks(state)).toEqual([1050, 0]);
  });
});

describe('abandonos', () => {
  it('quien abandona se retira de la mano y queda eliminado', () => {
    let s = deal(setupTable(3)).state;
    s = expectOk(removePlayer(s, 'p2', 0)).state; // no era su turno
    expect(s.players[2]!.status).toBe('eliminated');
    expect(s.hand!.toAct).toBe('p0');

    s = expectOk(removePlayer(s, 'p0', 0)).state; // era su turno
    // Solo queda p1: gana el bote (sus 5 + los 10 de p2) y la partida.
    expect(s.hand!.results).toEqual([{ amount: 15, winners: ['p1'], category: null }]);
    expect(s.status).toBe('finished');
    expect(s.winnerId).toBe('p1');
    expect(stacks(s)).toEqual([0, 1010, 0]);
  });
});

describe('vista por jugador', () => {
  it('no filtra las cartas de los demás ni la baraja', () => {
    const s = deal(setupTable(3)).state;
    const view = getPlayerView(s, 'p0');
    const json = JSON.stringify(view);

    expect(view.you!.holeCards).toEqual(s.hand!.holeCards['p0']);
    expect(view.you!.legal).not.toBeNull();
    expect(view.players.every((p) => p.holeCards === null)).toBe(true);
    for (const card of [...s.hand!.holeCards['p1']!, ...s.hand!.holeCards['p2']!, ...s.hand!.deck]) {
      expect(json).not.toContain(`"${card}"`);
    }
    expect(view.potTotal).toBe(15);
  });

  it('enseña las cartas en el showdown', () => {
    let s = deal(setupTable(2)).state;
    s = act(s, { type: 'call' });
    s = checkDown(s);
    const view = getPlayerView(s, 'p0');
    expect(view.players.every((p) => p.holeCards !== null)).toBe(true);
    expect(view.results).not.toBeNull();
  });
});

describe('partidas aleatorias', () => {
  function randomAction(state: TableState, rng: (n: number) => number): Action {
    const legal = getLegalActions(state, state.hand!.toAct!)!;
    const roll = rng(100);
    if (legal.raise && roll < 20) {
      return { type: 'raise', to: legal.raise.min + rng(legal.raise.max - legal.raise.min + 1) };
    }
    if (!legal.canCheck && roll < 40) return { type: 'fold' };
    return legal.canCheck ? { type: 'check' } : { type: 'call' };
  }

  function chipsInPlay(state: TableState): number {
    const inStacks = state.players.reduce((sum, p) => sum + p.stack, 0);
    const hand = state.hand;
    const inPot =
      hand && !hand.finished ? Object.values(hand.seats).reduce((sum, s) => sum + s.totalContributed, 0) : 0;
    return inStacks + inPot;
  }

  it.each(Array.from({ length: 40 }, (_, i) => i))(
    'semilla %i: no se crean ni se pierden fichas y la partida termina',
    (seed) => {
      const rng = seededRng(seed);
      const players = 2 + (seed % 5);
      const blinds = { ...standardBlindStructure(1000), increaseEvery: { type: 'hands' as const, value: 5 } };
      let s = setupTable(players, { blindStructure: blinds });
      const total = players * 1000;

      let hands = 0;
      while (s.status === 'playing') {
        s = expectOk(startHand(s, { rng, now: 0 })).state;
        expect(chipsInPlay(s)).toBe(total);
        while (!s.hand!.finished) {
          expect(s.hand!.toAct).not.toBeNull();
          s = expectOk(applyAction(s, s.hand!.toAct!, randomAction(s, rng), 0)).state;
          expect(chipsInPlay(s)).toBe(total);
          expect(s.players.every((p) => p.stack >= 0)).toBe(true);
        }
        expect(++hands).toBeLessThan(2000);
      }

      expect(s.status).toBe('finished');
      expect(s.players.find((p) => p.id === s.winnerId)!.stack).toBe(total);
    },
  );
});
