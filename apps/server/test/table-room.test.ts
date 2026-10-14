import type { GameEvent, PlayerView, RebuyRules, Rng } from '@solo-poker/engine';
import type { Session } from '@solo-poker/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TableRoom, type Connection, type RoomTimings } from '../src/table-room';

const TIMINGS: RoomTimings = {
  turnTimeoutMs: 1_000,
  reconnectGraceMs: 2_000,
  startDelayMs: 500,
  handPauseMs: 700,
};

class FakeConnection implements Connection {
  views: PlayerView[] = [];
  events: GameEvent[] = [];
  countdowns: (number | null)[] = [];
  replaced = false;

  get view(): PlayerView {
    return this.views.at(-1)!;
  }

  sendView(view: PlayerView) {
    this.views.push(view);
  }
  sendEvents(events: GameEvent[]) {
    this.events.push(...events);
  }
  sendCountdown(startsAt: number | null) {
    this.countdowns.push(startsAt);
  }
  replace() {
    this.replaced = true;
  }
}

const NO_REBUYS: RebuyRules = { maxPerPlayer: 0, untilMinutes: null, decisionMs: 20_000 };

function createRoom(maxPlayers = 2, rebuy: RebuyRules = NO_REBUYS, rng: Rng = () => 0) {
  return new TableRoom({
    id: 'ABC-DEF',
    passwordHash: 'unused',
    maxPlayers,
    buyIn: 1000,
    rebuy,
    timings: TIMINGS,
    rng, // por defecto () => 0: el botón empieza en el primer jugador
    now: () => Date.now(),
  });
}

function joinOk(room: TableRoom, connection: Connection, nickname: string): Session {
  const result = room.join(connection, nickname, `p:test-${nickname}`);
  if (!result.ok) throw new Error(result.error);
  return result;
}

/** Mesa de 2 llena y con la primera mano repartida. */
function startedRoom(rebuy: RebuyRules = NO_REBUYS, rng?: Rng) {
  const room = createRoom(2, rebuy, rng);
  const a = new FakeConnection();
  const b = new FakeConnection();
  const ana = joinOk(room, a, 'Ana');
  const bea = joinOk(room, b, 'Bea');
  vi.advanceTimersByTime(TIMINGS.startDelayMs);
  return { room, a, b, ana, bea };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TableRoom', () => {
  it('arranca la partida tras la cuenta atrás cuando la mesa se llena', () => {
    const room = createRoom();
    const a = new FakeConnection();
    const b = new FakeConnection();
    joinOk(room, a, 'Ana');
    expect(a.countdowns).toEqual([]);

    joinOk(room, b, 'Bea');
    expect(a.countdowns).toEqual([Date.now() + TIMINGS.startDelayMs]);
    expect(a.view.status).toBe('waiting');

    vi.advanceTimersByTime(TIMINGS.startDelayMs);
    expect(a.view.status).toBe('playing');
    expect(a.view.handNumber).toBe(1);
    expect(a.events.map((e) => e.type)).toContain('handStarted');
  });

  it('cada jugador solo ve sus propias cartas', () => {
    const { a, b, ana } = startedRoom();
    expect(a.view.you!.holeCards).toHaveLength(2);
    expect(b.view.you!.holeCards).toHaveLength(2);
    expect(a.view.you!.holeCards).not.toEqual(b.view.you!.holeCards);
    expect(b.view.players.find((p) => p.id === ana.playerId)!.holeCards).toBeNull();
  });

  it('rechaza acciones de una mano anterior', () => {
    const { room, ana } = startedRoom();
    expect(room.act(ana.playerId, 99, { type: 'fold' })).toEqual({ ok: false, error: 'STALE_HAND' });
  });

  it('agotar el tiempo de turno retira al jugador y luego se reparte otra mano', () => {
    const { a, ana } = startedRoom();
    expect(a.view.toAct).toBe(ana.playerId);

    vi.advanceTimersByTime(TIMINGS.turnTimeoutMs);
    expect(a.events).toContainEqual({ type: 'turnTimedOut', playerId: ana.playerId });
    expect(a.view.results).not.toBeNull();

    vi.advanceTimersByTime(TIMINGS.handPauseMs);
    expect(a.view.handNumber).toBe(2);
  });

  it('quien se desconecta puede volver dentro del margen', () => {
    const { room, a, b, ana } = startedRoom();
    room.disconnected(ana.playerId, a);
    expect(b.view.players.find((p) => p.id === ana.playerId)!.connected).toBe(false);

    const a2 = new FakeConnection();
    expect(room.rejoin(a2, ana.token).ok).toBe(true);
    expect(b.view.players.find((p) => p.id === ana.playerId)!.connected).toBe(true);
    expect(a2.view.you!.id).toBe(ana.playerId);

    vi.advanceTimersByTime(TIMINGS.reconnectGraceMs * 2);
    expect(room.snapshot.players.find((p) => p.id === ana.playerId)!.status).toBe('active');
  });

  it('quien no vuelve a tiempo queda eliminado', () => {
    const { room, a, b, ana, bea } = startedRoom();
    room.disconnected(ana.playerId, a);

    vi.advanceTimersByTime(TIMINGS.reconnectGraceMs);
    expect(b.view.status).toBe('finished');
    expect(b.view.winnerId).toBe(bea.playerId);
    expect(room.rejoin(new FakeConnection(), ana.token)).toEqual({ ok: false, error: 'INVALID_TOKEN' });
  });

  it('una segunda conexión con el mismo token sustituye a la primera', () => {
    const { room, a, ana } = startedRoom();
    const a2 = new FakeConnection();
    expect(room.rejoin(a2, ana.token).ok).toBe(true);
    expect(a.replaced).toBe(true);

    // La desconexión de la conexión antigua ya no cuenta.
    room.disconnected(ana.playerId, a);
    expect(room.snapshot.players.find((p) => p.id === ana.playerId)!.connected).toBe(true);
  });

  it('si alguien se va durante la cuenta atrás, se cancela', () => {
    const room = createRoom();
    const a = new FakeConnection();
    joinOk(room, a, 'Ana');
    const bea = joinOk(room, new FakeConnection(), 'Bea');

    expect(room.leave(bea.playerId).ok).toBe(true);
    expect(a.countdowns.at(-1)).toBeNull();

    vi.advanceTimersByTime(TIMINGS.startDelayMs * 2);
    expect(room.snapshot.status).toBe('waiting');
    expect(room.info.players).toBe(1);
  });

  it('abandonar invalida el token', () => {
    const { room, ana } = startedRoom();
    expect(room.leave(ana.playerId).ok).toBe(true);
    expect(room.rejoin(new FakeConnection(), ana.token)).toEqual({ ok: false, error: 'INVALID_TOKEN' });
  });

  it('una mesa vacía o abandonada se puede borrar', () => {
    const room = createRoom();
    expect(room.canBeDeleted(Date.now())).toBe(true);
    joinOk(room, new FakeConnection(), 'Ana');
    expect(room.canBeDeleted(Date.now())).toBe(false);
  });
});

/** Barajado pseudoaleatorio determinista: con la semilla 1, el all-in de la primera mano no acaba en empate. */
function lcg(seed: number): Rng {
  let x = seed;
  return (n) => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x % n;
  };
}

describe('TableRoom: recompras', () => {
  const REBUYS: RebuyRules = { maxPerPlayer: 1, untilMinutes: null, decisionMs: 20_000 };

  /** Los dos van all-in en la primera mano; devuelve quién se queda sin fichas. */
  function allIn(room: TableRoom) {
    while (room.snapshot.hand && !room.snapshot.hand.finished) {
      const id = room.snapshot.hand.toAct!;
      const handNumber = room.snapshot.hand.number;
      const ok =
        room.act(id, handNumber, { type: 'raise', to: 1000 }).ok || room.act(id, handNumber, { type: 'call' }).ok;
      expect(ok).toBe(true);
    }
    const loser = room.snapshot.players.find((p) => p.stack === 0);
    if (!loser) throw new Error('La mano acabó en empate: cambia el reparto del test');
    return loser.id;
  }

  it('espera a que el eliminado decida y, si se le acaba el plazo, termina la partida', () => {
    const { room, a } = startedRoom(REBUYS, lcg(1));
    const loserId = allIn(room);

    expect(room.snapshot.status).toBe('playing');
    expect(room.snapshot.players.find((p) => p.id === loserId)!.rebuyDeadline).not.toBeNull();
    // No se reparte otra mano mientras decide.
    vi.advanceTimersByTime(TIMINGS.handPauseMs * 3);
    expect(room.snapshot.handNumber).toBe(1);

    vi.advanceTimersByTime(REBUYS.decisionMs);
    expect(room.snapshot.status).toBe('finished');
    expect(a.events).toContainEqual({ type: 'rebuyDeclined', playerId: loserId });
  });

  it('quien recompra vuelve y se reparte la siguiente mano', () => {
    const { room, a } = startedRoom(REBUYS, lcg(1));
    const loserId = allIn(room);

    expect(room.rebuy(loserId).ok).toBe(true);
    expect(a.events).toContainEqual({ type: 'playerRebought', playerId: loserId, amount: 1000, rebuys: 1 });

    vi.advanceTimersByTime(TIMINGS.handPauseMs);
    expect(room.snapshot.handNumber).toBe(2);
    expect(room.snapshot.hand!.order).toContain(loserId);
  });

  it('quedarse mirando termina la partida si no quedan rivales', () => {
    const { room, a } = startedRoom(REBUYS, lcg(1));
    const loserId = allIn(room);
    expect(room.spectate(loserId).ok).toBe(true);
    expect(room.snapshot.status).toBe('finished');
  });
});
