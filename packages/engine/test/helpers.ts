import {
  addPlayer,
  applyAction,
  createDeck,
  createTable,
  startGame,
  startHand,
  type Action,
  type BlindStructure,
  type Card,
  type GameEvent,
  type RebuyRules,
  type Result,
  type Rng,
  type TableState,
} from '../src';

export const DEFAULT_BLINDS: BlindStructure = {
  levels: [
    { sb: 5, bb: 10 },
    { sb: 10, bb: 20 },
  ],
  increaseEvery: { type: 'hands', value: 1000 },
};

/** Generador determinista (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return (max) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max);
  };
}

export function expectOk(result: Result): { state: TableState; events: GameEvent[] } {
  if (!result.ok) throw new Error(`Engine error: ${result.error}`);
  return result;
}

/**
 * Mesa con jugadores p0..p(n-1), partida empezada y el botón en p0.
 * Cada jugador tiene 1000 céntimos salvo que se indiquen `stacks`.
 */
export function setupTable(
  n: number,
  opts: { stacks?: number[]; blindStructure?: BlindStructure; rebuy?: RebuyRules } = {},
): TableState {
  let state = createTable({
    id: 'T',
    maxPlayers: n,
    buyIn: 1000,
    blindStructure: opts.blindStructure ?? DEFAULT_BLINDS,
    turnTimeoutMs: 30_000,
    rebuy: opts.rebuy,
  });
  for (let i = 0; i < n; i++) {
    state = expectOk(addPlayer(state, { id: `p${i}`, nickname: `P${i}`, avatar: `p:test-${i}` })).state;
  }
  state = expectOk(startGame(state, () => 0, 0)).state;
  opts.stacks?.forEach((stack, i) => {
    state.players[i]!.stack = stack;
  });
  return state;
}

/**
 * Baraja preparada: `holes` en orden de reparto (empezando a la izquierda del
 * botón), después el tablero y el resto de cartas.
 */
export function stackDeck(holes: [Card, Card][], board: Card[]): Card[] {
  const used = [...holes.flat(), ...board];
  return [...used, ...createDeck().filter((c) => !used.includes(c))];
}

export function deal(state: TableState, deck?: Card[]): { state: TableState; events: GameEvent[] } {
  return expectOk(startHand(state, { rng: seededRng(1), now: 0, deck }));
}

/** Hace actuar al jugador en turno. */
export function act(state: TableState, action: Action): TableState {
  return actWithEvents(state, action).state;
}

export function actWithEvents(state: TableState, action: Action) {
  return expectOk(applyAction(state, state.hand!.toAct!, action, 0));
}

/** Pasa con todos hasta que la mano acabe. */
export function checkDown(state: TableState): TableState {
  while (state.hand && !state.hand.finished) state = act(state, { type: 'check' });
  return state;
}

export const stacks = (state: TableState) => state.players.map((p) => p.stack);
