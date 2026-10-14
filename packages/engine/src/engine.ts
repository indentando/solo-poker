import { createDeck, shuffle } from './cards';
import { evaluateHand, type HandValue } from './evaluator';
import { computePots, splitAmount } from './pots';
import type {
  Action,
  BlindLevel,
  Card,
  Cents,
  EngineError,
  GameEvent,
  HandSeat,
  HandState,
  LegalActions,
  Player,
  PlayerId,
  RebuyRules,
  Result,
  Rng,
  TableConfig,
  TableState,
} from './types';

/*
 * Todas las funciones públicas son puras: reciben un estado y devuelven uno nuevo
 * más los eventos que han ocurrido. No hay red, timers ni reloj: el tiempo (`now`)
 * y el azar (`rng`) se inyectan desde el servidor.
 */

type Events = GameEvent[];

const MAX_NICKNAME_LENGTH = 20;

const ok = (state: TableState, events: Events = []): Result => ({ ok: true, state, events });
const fail = (error: EngineError): Result => ({ ok: false, error });

/** El estado es JSON plano, así que este clon es seguro y no depende del entorno. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ─── Helpers internos ───────────────────────────────────────────

function findPlayer(state: TableState, id: PlayerId): Player | undefined {
  return state.players.find((p) => p.id === id);
}

function mustPlayer(state: TableState, id: PlayerId): Player {
  const player = findPlayer(state, id);
  if (!player) throw new Error(`Unknown player ${id}`);
  return player;
}

function alivePlayers(state: TableState): Player[] {
  return state.players.filter((p) => p.status === 'active');
}

export function currentBlindLevel(state: TableState): BlindLevel {
  return state.config.blindStructure.levels[state.blindLevel]!;
}

function nextSeatAfter(seats: number[], seat: number): number {
  return seats.find((s) => s > seat) ?? seats[0]!;
}

function seatOf(hand: HandState, id: PlayerId): HandSeat {
  return hand.seats[id]!;
}

/** Recorre la mesa en sentido horario desde `fromId` y devuelve el primero que cumpla `predicate`. */
function nextFrom(
  hand: HandState,
  fromId: PlayerId,
  predicate: (id: PlayerId) => boolean,
  inclusive = false,
): PlayerId | undefined {
  const start = hand.order.indexOf(fromId);
  const n = hand.order.length;
  for (let i = inclusive ? 0 : 1; i <= n; i++) {
    const id = hand.order[(start + i) % n]!;
    if (predicate(id)) return id;
  }
  return undefined;
}

function needsAction(hand: HandState, id: PlayerId): boolean {
  const seat = seatOf(hand, id);
  return seat.state === 'active' && (!seat.hasActed || seat.betThisStreet < hand.currentBet);
}

/** Mueve fichas del stack al bote. Si el jugador no llega, pone lo que tiene y queda all-in. */
function post(state: TableState, id: PlayerId, amount: Cents, countsForStreet: boolean): Cents {
  const player = mustPlayer(state, id);
  const seat = seatOf(state.hand!, id);
  const posted = Math.min(amount, player.stack);
  player.stack -= posted;
  seat.totalContributed += posted;
  if (countsForStreet) seat.betThisStreet += posted;
  if (player.stack === 0 && seat.state === 'active') seat.state = 'allIn';
  return posted;
}

// ─── Mesa y jugadores ───────────────────────────────────────────

export const NO_REBUYS: RebuyRules = { maxPerPlayer: 0, untilMinutes: null, decisionMs: 20_000 };

export type TableConfigInput = Omit<TableConfig, 'rebuy'> & { rebuy?: RebuyRules };

export function createTable(config: TableConfigInput): TableState {
  return {
    config: { ...config, rebuy: config.rebuy ?? NO_REBUYS },
    status: 'waiting',
    players: [],
    buttonSeat: -1,
    blindLevel: 0,
    levelStartedAt: 0,
    handNumber: 0,
    hand: null,
    winnerId: null,
    startedAt: null,
    finishedAt: null,
  };
}

/** Hora a la que se cierran las recompras, o null si están abiertas toda la partida. */
export function rebuyClosesAt(state: TableState): number | null {
  const { untilMinutes } = state.config.rebuy;
  if (untilMinutes === null || state.startedAt === null) return null;
  return state.startedAt + untilMinutes * 60_000;
}

/** ¿Puede este jugador recomprar ahora mismo (según el número de recompras y la ventana de tiempo)? */
function rebuyAvailable(state: TableState, player: Player, now: number): boolean {
  const { maxPerPlayer } = state.config.rebuy;
  if (state.status !== 'playing' || maxPerPlayer === 0) return false;
  if (maxPerPlayer !== null && player.rebuys >= maxPerPlayer) return false;
  const closesAt = rebuyClosesAt(state);
  return closesAt === null || now < closesAt;
}

export function addPlayer(
  state: TableState,
  input: { id: PlayerId; nickname: string; avatar: string },
): Result {
  if (state.status !== 'waiting') return fail('GAME_NOT_WAITING');
  const nickname = input.nickname.trim();
  if (nickname.length === 0 || nickname.length > MAX_NICKNAME_LENGTH) return fail('INVALID_NICKNAME');
  if (input.avatar.length === 0) return fail('INVALID_AVATAR');
  if (state.players.length >= state.config.maxPlayers) return fail('TABLE_FULL');
  if (findPlayer(state, input.id)) return fail('PLAYER_ALREADY_SEATED');
  if (state.players.some((p) => p.nickname.toLowerCase() === nickname.toLowerCase())) {
    return fail('NICKNAME_TAKEN');
  }
  // Cada jugador de la mesa lleva un icono distinto, para poder distinguirlos de un vistazo.
  if (state.players.some((p) => p.avatar === input.avatar)) return fail('AVATAR_TAKEN');

  const next = clone(state);
  const taken = new Set(next.players.map((p) => p.seat));
  let seat = 0;
  while (taken.has(seat)) seat++;

  next.players.push({
    id: input.id,
    nickname,
    avatar: input.avatar,
    seat,
    stack: next.config.buyIn,
    status: 'active',
    connected: true,
    rebuys: 0,
    rebuyDeadline: null,
  });
  next.players.sort((a, b) => a.seat - b.seat);
  return ok(next, [{ type: 'playerJoined', playerId: input.id, nickname, avatar: input.avatar, seat }]);
}

export function setConnected(state: TableState, playerId: PlayerId, connected: boolean): Result {
  if (!findPlayer(state, playerId)) return fail('PLAYER_NOT_FOUND');
  const next = clone(state);
  mustPlayer(next, playerId).connected = connected;
  return ok(next, [{ type: 'playerConnection', playerId, connected }]);
}

/**
 * Un jugador abandona. En la sala de espera libera su asiento; con la partida
 * empezada queda eliminado: si está en una mano se retira y lo que ya puso en
 * el bote se queda allí. Las fichas que le quedan salen de la mesa con él:
 * al saldar cuentas cuentan como lo que se lleva.
 */
export function removePlayer(state: TableState, playerId: PlayerId, now: number): Result {
  if (!findPlayer(state, playerId)) return fail('PLAYER_NOT_FOUND');
  const next = clone(state);
  const events: Events = [];

  if (next.status === 'waiting') {
    next.players = next.players.filter((p) => p.id !== playerId);
    return ok(next, [{ type: 'playerLeft', playerId }]);
  }

  const player = mustPlayer(next, playerId);
  if (next.status === 'finished') return ok(next);
  if (player.status === 'eliminated') {
    // Si se va mientras decidía si recomprar, cuenta como que no recompra.
    if (player.rebuyDeadline === null) return ok(next);
    player.rebuyDeadline = null;
    events.push({ type: 'playerLeft', playerId }, { type: 'rebuyDeclined', playerId });
    checkGameOver(next, events, now);
    return ok(next, events);
  }

  player.status = 'eliminated';
  events.push({ type: 'playerLeft', playerId }, { type: 'playerEliminated', playerId, canRebuy: false });

  const hand = next.hand;
  const seat = hand?.seats[playerId];
  if (hand && !hand.finished && seat && seat.state !== 'folded') {
    seat.state = 'folded';
    seat.lastAction = 'fold';
    events.push({ type: 'playerActed', playerId, action: { type: 'fold' }, amount: 0, allIn: false });
    if (hand.toAct === playerId) advance(next, events, now, playerId);
    else advance(next, events, now, hand.toAct!, true);
  }

  checkGameOver(next, events, now);
  return ok(next, events);
}

// ─── Recompras ──────────────────────────────────────────────────

/** El jugador eliminado vuelve a la mesa con una entrada nueva. Entra en la siguiente mano. */
export function rebuy(state: TableState, playerId: PlayerId, now: number): Result {
  const player = findPlayer(state, playerId);
  if (!player) return fail('PLAYER_NOT_FOUND');
  if (state.status !== 'playing') return fail('GAME_NOT_PLAYING');
  // Solo mientras está decidiendo: el plazo se concede al quedarse sin fichas, si las reglas lo permitían.
  if (player.status !== 'eliminated' || player.rebuyDeadline === null) return fail('REBUY_NOT_ALLOWED');

  const next = clone(state);
  const p = mustPlayer(next, playerId);
  p.stack = next.config.buyIn;
  p.status = 'active';
  p.rebuys++;
  p.rebuyDeadline = null;
  return ok(next, [{ type: 'playerRebought', playerId, amount: next.config.buyIn, rebuys: p.rebuys }]);
}

/** El jugador decide no recomprar (o se le acaba el plazo): se queda mirando. */
export function declineRebuy(state: TableState, playerId: PlayerId, now: number): Result {
  const player = findPlayer(state, playerId);
  if (!player) return fail('PLAYER_NOT_FOUND');
  if (player.rebuyDeadline === null) return fail('REBUY_NOT_ALLOWED');

  const next = clone(state);
  mustPlayer(next, playerId).rebuyDeadline = null;
  const events: Events = [{ type: 'rebuyDeclined', playerId }];
  checkGameOver(next, events, now);
  return ok(next, events);
}

// ─── Partida ────────────────────────────────────────────────────

export function startGame(state: TableState, rng: Rng, now: number): Result {
  if (state.status !== 'waiting') return fail('GAME_NOT_WAITING');
  if (state.players.length < 2) return fail('NOT_ENOUGH_PLAYERS');

  const next = clone(state);
  next.status = 'playing';
  next.startedAt = now;
  next.buttonSeat = next.players[rng(next.players.length)]!.seat;
  next.levelStartedAt = next.config.blindStructure.increaseEvery.type === 'minutes' ? now : 0;
  return ok(next, [{ type: 'gameStarted', buttonSeat: next.buttonSeat }]);
}

export interface StartHandOptions {
  rng: Rng;
  now: number;
  /** Solo para tests: baraja ya ordenada. */
  deck?: Card[];
}

/**
 * Reparte una mano nueva.
 *
 * Orden de reparto: empezando por el jugador a la izquierda del botón, dos
 * cartas seguidas a cada uno; después flop, turn y river (sin cartas quemadas,
 * que en digital no aportan nada).
 */
export function startHand(state: TableState, opts: StartHandOptions): Result {
  if (state.status !== 'playing') return fail('GAME_NOT_PLAYING');
  if (state.hand && !state.hand.finished) return fail('HAND_IN_PROGRESS');
  // Si alguien está decidiendo si recompra, se le espera: podría volver en esta mano.
  if (state.players.some((p) => p.rebuyDeadline !== null)) return fail('WAITING_FOR_REBUY');

  const next = clone(state);
  const events: Events = [];

  // Las ciegas solo suben entre manos, nunca a mitad de una.
  const { levels, increaseEvery } = next.config.blindStructure;
  if (next.handNumber > 0 && next.blindLevel < levels.length - 1) {
    const due =
      increaseEvery.type === 'minutes'
        ? opts.now - next.levelStartedAt >= increaseEvery.value * 60_000
        : next.handNumber - next.levelStartedAt >= increaseEvery.value;
    if (due) {
      next.blindLevel++;
      next.levelStartedAt = increaseEvery.type === 'minutes' ? opts.now : next.handNumber;
      const level = currentBlindLevel(next);
      events.push({ type: 'blindsIncreased', level: next.blindLevel, sb: level.sb, bb: level.bb });
    }
  }

  const alive = alivePlayers(next);
  if (alive.length < 2) return fail('NOT_ENOUGH_PLAYERS');

  // El botón avanza al siguiente jugador vivo (o se recoloca si su dueño abandonó).
  const seats = alive.map((p) => p.seat);
  if (next.handNumber > 0 || !seats.includes(next.buttonSeat)) {
    next.buttonSeat = nextSeatAfter(seats, next.buttonSeat);
  }
  next.handNumber++;

  const order = alive.map((p) => p.id);
  const buttonIndex = seats.indexOf(next.buttonSeat);
  const at = (offset: number) => order[(buttonIndex + offset) % order.length]!;
  const headsUp = order.length === 2;
  const buttonId = at(0);
  // En heads-up el botón paga la ciega pequeña.
  const sbId = headsUp ? at(0) : at(1);
  const bbId = headsUp ? at(1) : at(2);

  const deck = opts.deck ? [...opts.deck] : shuffle(createDeck(), opts.rng);
  const holeCards: Record<PlayerId, [Card, Card]> = {};
  for (let i = 1; i <= order.length; i++) {
    holeCards[at(i)] = [deck.shift()!, deck.shift()!];
  }

  const level = currentBlindLevel(next);
  next.hand = {
    number: next.handNumber,
    order,
    buttonId,
    sbId,
    bbId,
    deck,
    holeCards,
    board: [],
    street: 'preflop',
    seats: Object.fromEntries(
      order.map((id) => [
        id,
        { state: 'active', betThisStreet: 0, totalContributed: 0, hasActed: false, lastAction: null },
      ]),
    ),
    currentBet: level.bb,
    minRaise: level.bb,
    toAct: null,
    turnDeadline: null,
    revealed: false,
    finished: false,
    results: [],
  };

  const ante = level.ante ?? 0;
  if (ante > 0) for (const id of order) post(next, id, ante, false);
  const sbAmount = post(next, sbId, level.sb, true);
  const bbAmount = post(next, bbId, level.bb, true);

  events.push(
    { type: 'handStarted', handNumber: next.handNumber, buttonSeat: next.buttonSeat },
    {
      type: 'blindsPosted',
      sb: { playerId: sbId, amount: sbAmount },
      bb: { playerId: bbId, amount: bbAmount },
      ante,
    },
  );

  // Preflop habla primero el jugador tras la ciega grande (en heads-up, el botón).
  advance(next, events, opts.now, bbId);
  return ok(next, events);
}

// ─── Acciones ───────────────────────────────────────────────────

export function getLegalActions(state: TableState, playerId: PlayerId): LegalActions | null {
  const hand = state.hand;
  if (state.status !== 'playing' || !hand || hand.finished || hand.toAct !== playerId) return null;

  const seat = seatOf(hand, playerId);
  const player = mustPlayer(state, playerId);
  const toCall = Math.max(0, hand.currentBet - seat.betThisStreet);
  const maxRaiseTo = seat.betThisStreet + player.stack;

  // Subir solo tiene sentido si queda alguien más que pueda responder.
  const othersCanAct = hand.order.some((id) => id !== playerId && seatOf(hand, id).state === 'active');
  // Si ya actuó en esta calle, solo puede volver a subir si alguien hizo una subida completa
  // (las subidas completas reinician `hasActed`). Un all-in corto no reabre la acción.
  const canRaise = !seat.hasActed && othersCanAct && maxRaiseTo > hand.currentBet;

  return {
    canFold: true,
    canCheck: toCall === 0,
    callAmount: Math.min(toCall, player.stack),
    raise: canRaise
      ? { min: Math.min(hand.currentBet + hand.minRaise, maxRaiseTo), max: maxRaiseTo }
      : null,
  };
}

export function applyAction(state: TableState, playerId: PlayerId, action: Action, now: number): Result {
  if (state.status !== 'playing') return fail('GAME_NOT_PLAYING');
  if (!state.hand || state.hand.finished) return fail('NO_HAND_IN_PROGRESS');
  if (state.hand.toAct !== playerId) return fail('NOT_YOUR_TURN');
  const legal = getLegalActions(state, playerId)!;

  const next = clone(state);
  const hand = next.hand!;
  const seat = seatOf(hand, playerId);
  const events: Events = [];
  let amount = 0;

  switch (action.type) {
    case 'fold':
      seat.state = 'folded';
      break;
    case 'check':
      if (!legal.canCheck) return fail('ILLEGAL_ACTION');
      break;
    case 'call':
      if (legal.callAmount === 0) return fail('ILLEGAL_ACTION');
      amount = post(next, playerId, legal.callAmount, true);
      break;
    case 'raise': {
      if (!legal.raise) return fail('ILLEGAL_ACTION');
      const to = action.to;
      if (!Number.isInteger(to) || to < legal.raise.min || to > legal.raise.max) {
        return fail('INVALID_AMOUNT');
      }
      const raiseSize = to - hand.currentBet;
      amount = post(next, playerId, to - seat.betThisStreet, true);
      if (raiseSize >= hand.minRaise) {
        // Subida completa: reabre la acción para todos los demás.
        hand.minRaise = raiseSize;
        for (const id of hand.order) {
          const other = seatOf(hand, id);
          if (id !== playerId && other.state === 'active') other.hasActed = false;
        }
      }
      hand.currentBet = to;
      break;
    }
    default:
      return fail('ILLEGAL_ACTION');
  }

  seat.hasActed = true;
  seat.lastAction = action.type;
  events.push({ type: 'playerActed', playerId, action, amount, allIn: seat.state === 'allIn' });

  advance(next, events, now, playerId);
  return ok(next, events);
}

/** Se agotó el tiempo del jugador en turno: pasa si puede, si no se retira. */
export function handleTimeout(state: TableState, now: number): Result {
  const playerId = state.hand?.toAct;
  if (!playerId || state.hand!.finished) return fail('NO_HAND_IN_PROGRESS');
  const legal = getLegalActions(state, playerId)!;

  const result = applyAction(state, playerId, legal.canCheck ? { type: 'check' } : { type: 'fold' }, now);
  if (result.ok) result.events.unshift({ type: 'turnTimedOut', playerId });
  return result;
}

// ─── Flujo de la mano ───────────────────────────────────────────

/** Decide quién habla a continuación, o cierra la ronda de apuestas si ya no habla nadie. */
function advance(state: TableState, events: Events, now: number, fromId: PlayerId, inclusive = false): void {
  const hand = state.hand!;
  const live = hand.order.filter((id) => seatOf(hand, id).state !== 'folded');
  if (live.length === 1) return finishByFold(state, events, now);

  const canAct = hand.order.filter((id) => seatOf(hand, id).state === 'active');
  // Si solo uno puede apostar y ya iguala lo máximo, no hay nadie contra quien apostar.
  const bettingOver =
    canAct.length === 0 ||
    (canAct.length === 1 && seatOf(hand, canAct[0]!).betThisStreet >= hand.currentBet);

  const nextId = bettingOver ? undefined : nextFrom(hand, fromId, (id) => needsAction(hand, id), inclusive);
  if (!nextId) return closeRound(state, events, now);

  if (hand.toAct !== nextId) hand.turnDeadline = now + state.config.turnTimeoutMs;
  hand.toAct = nextId;
}

function closeRound(state: TableState, events: Events, now: number): void {
  const hand = state.hand!;
  refundUncalled(state, events);
  hand.toAct = null;
  hand.turnDeadline = null;

  for (;;) {
    if (hand.street === 'river') return showdown(state, events, now);

    const canAct = hand.order.filter((id) => seatOf(hand, id).state === 'active');
    if (canAct.length <= 1) {
      // No quedan apuestas posibles: se enseñan las cartas y se reparte el resto del tablero.
      if (!hand.revealed) reveal(state, events);
      dealStreet(state, events);
      continue;
    }

    dealStreet(state, events);
    // Después del flop habla primero el jugador a la izquierda del botón.
    return advance(state, events, now, hand.buttonId);
  }
}

const NEXT_STREET = { preflop: 'flop', flop: 'turn', turn: 'river' } as const;

function dealStreet(state: TableState, events: Events): void {
  const hand = state.hand!;
  const street = NEXT_STREET[hand.street as keyof typeof NEXT_STREET];
  const cards = hand.deck.splice(0, street === 'flop' ? 3 : 1);
  hand.board.push(...cards);
  hand.street = street;

  for (const id of hand.order) {
    const seat = seatOf(hand, id);
    seat.betThisStreet = 0;
    seat.hasActed = false;
    seat.lastAction = null;
  }
  hand.currentBet = 0;
  hand.minRaise = currentBlindLevel(state).bb;
  events.push({ type: 'streetDealt', street, cards });
}

/** Devuelve la parte de la apuesta más alta de la calle que nadie ha igualado. */
function refundUncalled(state: TableState, events: Events): void {
  const hand = state.hand!;
  const [topId, secondId] = [...hand.order].sort(
    (a, b) => seatOf(hand, b).betThisStreet - seatOf(hand, a).betThisStreet,
  );
  if (!topId) return;

  const top = seatOf(hand, topId);
  // Si quien más apostó se retiró (p. ej. abandonó la mesa), sus fichas se quedan en el bote.
  if (top.state === 'folded') return;

  const excess = top.betThisStreet - (secondId ? seatOf(hand, secondId).betThisStreet : 0);
  if (excess <= 0) return;

  top.betThisStreet -= excess;
  top.totalContributed -= excess;
  mustPlayer(state, topId).stack += excess;
  if (top.state === 'allIn') top.state = 'active';
  events.push({ type: 'uncalledReturned', playerId: topId, amount: excess });
}

function reveal(state: TableState, events: Events): void {
  const hand = state.hand!;
  hand.revealed = true;
  const reveals: Record<PlayerId, [Card, Card]> = {};
  for (const id of hand.order) {
    if (seatOf(hand, id).state !== 'folded') reveals[id] = hand.holeCards[id]!;
  }
  events.push({ type: 'showdown', reveals });
}

function finishByFold(state: TableState, events: Events, now: number): void {
  const hand = state.hand!;
  refundUncalled(state, events);
  const winner = hand.order.find((id) => seatOf(hand, id).state !== 'folded')!;
  const amount = hand.order.reduce((sum, id) => sum + seatOf(hand, id).totalContributed, 0);
  mustPlayer(state, winner).stack += amount;

  const result = { amount, winners: [winner], category: null };
  hand.results.push(result);
  events.push({ type: 'potAwarded', ...result });
  endHand(state, events, now);
}

function showdown(state: TableState, events: Events, now: number): void {
  const hand = state.hand!;
  hand.street = 'showdown';
  if (!hand.revealed) reveal(state, events);

  const pots = computePots(
    hand.order.map((id) => {
      const seat = seatOf(hand, id);
      return { id, amount: seat.totalContributed, folded: seat.state === 'folded' };
    }),
  );

  const values = new Map<PlayerId, HandValue>();
  for (const id of hand.order) {
    if (seatOf(hand, id).state !== 'folded') {
      values.set(id, evaluateHand([...hand.holeCards[id]!, ...hand.board]));
    }
  }

  // Los céntimos que no se pueden repartir van al primer ganador a la izquierda del botón.
  const buttonIndex = hand.order.indexOf(hand.buttonId);
  const payoutOrder = [...hand.order.slice(buttonIndex + 1), ...hand.order.slice(0, buttonIndex + 1)];

  for (const pot of pots) {
    const best = Math.max(...pot.eligible.map((id) => values.get(id)!.score));
    const winners = payoutOrder.filter((id) => pot.eligible.includes(id) && values.get(id)!.score === best);
    const shares = splitAmount(pot.amount, winners.length);
    winners.forEach((id, i) => {
      mustPlayer(state, id).stack += shares[i]!;
    });

    const result = { amount: pot.amount, winners, category: values.get(winners[0]!)!.category };
    hand.results.push(result);
    events.push({ type: 'potAwarded', ...result });
  }

  endHand(state, events, now);
}

function endHand(state: TableState, events: Events, now: number): void {
  const hand = state.hand!;
  hand.finished = true;
  hand.toAct = null;
  hand.turnDeadline = null;

  for (const player of state.players) {
    if (player.status === 'active' && player.stack === 0) {
      player.status = 'eliminated';
      // Si las reglas lo permiten, tiene un plazo para decidir si recompra.
      const canRebuy = rebuyAvailable(state, player, now);
      player.rebuyDeadline = canRebuy ? now + state.config.rebuy.decisionMs : null;
      events.push({ type: 'playerEliminated', playerId: player.id, canRebuy });
    }
  }
  checkGameOver(state, events, now);
}

function checkGameOver(state: TableState, events: Events, now: number): void {
  if (state.status !== 'playing') return;
  if (state.hand && !state.hand.finished) return;
  // Alguien que puede recomprar todavía puede volver: la partida no ha terminado.
  if (state.players.some((p) => p.rebuyDeadline !== null)) return;

  const alive = alivePlayers(state);
  if (alive.length <= 1) {
    state.status = 'finished';
    state.finishedAt = now;
    state.winnerId = alive[0]?.id ?? null;
    events.push({ type: 'gameOver', winnerId: state.winnerId });
  }
}
