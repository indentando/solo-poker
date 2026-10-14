import type { GameEvent, PlayerView } from '@solo-poker/engine';
import type { ClientToServerEvents, ServerToClientEvents } from '@solo-poker/protocol';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPokerServer } from '../src/server';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: ReturnType<typeof createPokerServer>;
let url: string;
const clients: Client[] = [];

beforeEach(async () => {
  server = createPokerServer({
    timings: { turnTimeoutMs: 5_000, reconnectGraceMs: 5_000, startDelayMs: 50, handPauseMs: 50 },
  });
  const port = await server.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  await server.close();
});

async function client(): Promise<Client> {
  const socket: Client = connect(url, { transports: ['websocket'], forceNew: true });
  clients.push(socket);
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
  return socket;
}

/** Espera a una vista que cumpla `predicate`. */
function waitForView(socket: Client, predicate: (view: PlayerView) => boolean): Promise<PlayerView> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout esperando la vista')), 2_000);
    const listener = (view: PlayerView) => {
      if (!predicate(view)) return;
      clearTimeout(timer);
      socket.off('table:view', listener);
      resolve(view);
    };
    socket.on('table:view', listener);
  });
}

function waitForEvent(socket: Client, type: GameEvent['type']): Promise<GameEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout esperando ${type}`)), 2_000);
    const listener = (events: GameEvent[]) => {
      const event = events.find((e) => e.type === type);
      if (!event) return;
      clearTimeout(timer);
      socket.off('game:events', listener);
      resolve(event);
    };
    socket.on('game:events', listener);
  });
}

describe('servidor Socket.IO', () => {
  it('responde al health check', async () => {
    const res = await fetch(`${url}/health`);
    expect(await res.json()).toEqual({ status: 'ok', tables: 0 });
  });

  it('flujo completo: crear, unirse, jugar y abandonar', async () => {
    const ana = await client();
    const created = await ana.emitWithAck('table:create', {
      nickname: 'Ana',
      avatar: 'p:spade',
      password: 'secreta',
      maxPlayers: 2,
      buyIn: 1000,
      rebuys: { max: 0, untilMinutes: null },
    });
    if (!created.ok) throw new Error(created.error);
    expect(created.tableId).toMatch(/^[0-9A-Z]{3}-[0-9A-Z]{3}$/);

    const bea = await client();
    // El id se acepta en minúsculas y sin guion.
    const lowerId = created.tableId.replace('-', '').toLowerCase();
    const info = await bea.emitWithAck('table:info', { tableId: lowerId });
    expect(info).toEqual({
      ok: true,
      table: {
        tableId: created.tableId,
        status: 'waiting',
        players: 1,
        maxPlayers: 2,
        buyIn: 1000,
        takenAvatars: ['p:spade'],
      },
    });

    expect(
      await bea.emitWithAck('table:join', { tableId: created.tableId, password: 'mala', nickname: 'Bea', avatar: 'p:heart' }),
    ).toEqual({ ok: false, error: 'WRONG_PASSWORD' });

    const anaPlaying = waitForView(ana, (v) => v.status === 'playing' && v.handNumber === 1);
    const beaPlaying = waitForView(bea, (v) => v.status === 'playing' && v.handNumber === 1);
    const joined = await bea.emitWithAck('table:join', {
      tableId: created.tableId,
      password: 'secreta',
      nickname: 'Bea',
      avatar: 'p:heart',
    });
    expect(joined.ok).toBe(true);

    const [anaView, beaView] = await Promise.all([anaPlaying, beaPlaying]);
    // Nadie recibe las cartas del rival.
    expect(JSON.stringify(beaView)).not.toContain(`"${anaView.you!.holeCards![0]}"`);

    // Actúa quien tenga el turno y el rival recibe el evento.
    const [actor, other, actorView] =
      anaView.toAct === anaView.you!.id ? [ana, bea, anaView] : [bea, ana, beaView];
    const acted = waitForEvent(other, 'playerActed');
    expect(
      await actor.emitWithAck('game:action', { handNumber: actorView.handNumber, action: { type: 'call' } }),
    ).toEqual({ ok: true });
    expect(await acted).toMatchObject({ type: 'playerActed', action: { type: 'call' } });

    // Abandonar termina la partida para el otro.
    const finished = waitForView(other, (v) => v.status === 'finished');
    expect(await actor.emitWithAck('table:leave', {})).toEqual({ ok: true });
    expect((await finished).winnerId).not.toBeNull();
  });

  it('rechaza payloads inválidos y acciones fuera de mesa', async () => {
    const socket = await client();
    expect(await socket.emitWithAck('table:info', { tableId: '???' })).toEqual({
      ok: false,
      error: 'INVALID_PAYLOAD',
    });
    expect(
      await socket.emitWithAck('table:create', {
        nickname: '',
        avatar: 'e:no-emoji',
        password: 'x',
        maxPlayers: 20,
        buyIn: 1,
        rebuys: { max: 0, untilMinutes: null },
      }),
    ).toEqual({ ok: false, error: 'INVALID_PAYLOAD' });
    expect(await socket.emitWithAck('game:action', { handNumber: 1, action: { type: 'fold' } })).toEqual({
      ok: false,
      error: 'NOT_IN_TABLE',
    });
  });

  it('permite reconectar con el token', async () => {
    const ana = await client();
    const created = await ana.emitWithAck('table:create', {
      nickname: 'Ana',
      avatar: 'p:spade',
      password: 'secreta',
      maxPlayers: 3,
      buyIn: 1000,
      rebuys: { max: 0, untilMinutes: null },
    });
    if (!created.ok) throw new Error(created.error);
    ana.disconnect();

    const again = await client();
    const view = waitForView(again, (v) => v.you?.id === created.playerId);
    const rejoined = await again.emitWithAck('table:rejoin', { tableId: created.tableId, token: created.token });
    expect(rejoined).toMatchObject({ ok: true, playerId: created.playerId });
    expect((await view).players[0]!.connected).toBe(true);
  });
});
