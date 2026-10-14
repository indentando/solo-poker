import type { Ack, ClientToServerEvents, ServerError, ServerToClientEvents } from '@solo-poker/protocol';
import {
  createTableSchema,
  gameActionSchema,
  joinTableSchema,
  leaveTableSchema,
  rebuyDecisionSchema,
  rejoinTableSchema,
  tableInfoSchema,
} from '@solo-poker/protocol/schemas';
import type { Server, Socket } from 'socket.io';
import type { z } from 'zod';
import type { RateLimiter } from './security';
import type { TableManager } from './table-manager';
import type { Connection, TableRoom } from './table-room';

export type PokerServer = Server<ClientToServerEvents, ServerToClientEvents>;
type PokerSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export interface SocketDeps {
  manager: TableManager;
  createLimiter: RateLimiter;
  joinLimiter: RateLimiter;
}

const fail = (error: ServerError): Ack => ({ ok: false, error });

export function registerSocketHandlers(io: PokerServer, deps: SocketDeps): void {
  io.on('connection', (socket) => handleConnection(socket, deps));
}

function handleConnection(socket: PokerSocket, { manager, createLimiter, joinLimiter }: SocketDeps): void {
  const ip = socket.handshake.address;
  // Cada socket está como mucho en una mesa.
  let session: { room: TableRoom; playerId: string } | null = null;

  const connection: Connection = {
    sendView: (view) => socket.emit('table:view', view, Date.now()),
    sendEvents: (events) => socket.emit('game:events', events),
    sendCountdown: (startsAt) => socket.emit('table:countdown', { startsAt, serverNow: Date.now() }),
    replace: () => {
      session = null;
      socket.emit('session:replaced');
      socket.disconnect(true);
    },
  };

  /** Registra un evento: valida el payload con zod y responde siempre por el ack. */
  function on<S extends z.ZodType>(
    event: keyof ClientToServerEvents,
    schema: S,
    handler: (data: z.output<S>) => Ack<object> | Promise<Ack<object>>,
  ): void {
    (socket as unknown as Socket).on(event, async (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') return;
      const parsed = schema.safeParse(payload);
      if (!parsed.success) return ack(fail('INVALID_PAYLOAD'));
      try {
        ack(await handler(parsed.data));
      } catch (err) {
        console.error(`[${event}]`, err);
        ack(fail('INTERNAL_ERROR'));
      }
    });
  }

  on('table:create', createTableSchema, async (data) => {
    if (session) return fail('ALREADY_IN_TABLE');
    if (!createLimiter.take(ip)) return fail('RATE_LIMITED');

    const room = await manager.create(data);
    if (!room) return fail('SERVER_FULL');
    const result = room.join(connection, data.nickname, data.avatar);
    if (result.ok) session = { room, playerId: result.playerId };
    return result;
  });

  on('table:info', tableInfoSchema, ({ tableId }) => {
    const room = manager.get(tableId);
    return room ? { ok: true, table: room.info } : fail('TABLE_NOT_FOUND');
  });

  on('table:join', joinTableSchema, async (data) => {
    if (session) return fail('ALREADY_IN_TABLE');
    // Los intentos con clave incorrecta también cuentan: frena la fuerza bruta.
    if (!joinLimiter.take(ip)) return fail('RATE_LIMITED');

    const room = manager.get(data.tableId);
    if (!room) return fail('TABLE_NOT_FOUND');
    if (!(await room.checkPassword(data.password))) return fail('WRONG_PASSWORD');
    if (session) return fail('ALREADY_IN_TABLE'); // pudo unirse mientras se verificaba la clave

    const result = room.join(connection, data.nickname, data.avatar);
    if (result.ok) session = { room, playerId: result.playerId };
    return result;
  });

  on('table:rejoin', rejoinTableSchema, ({ tableId, token }) => {
    if (session) return fail('ALREADY_IN_TABLE');
    const room = manager.get(tableId);
    if (!room) return fail('TABLE_NOT_FOUND');

    const result = room.rejoin(connection, token);
    if (result.ok) session = { room, playerId: result.playerId };
    return result;
  });

  on('table:leave', leaveTableSchema, () => {
    if (!session) return fail('NOT_IN_TABLE');
    const { room, playerId } = session;
    session = null;
    return room.leave(playerId);
  });

  on('game:action', gameActionSchema, ({ handNumber, action }) => {
    if (!session) return fail('NOT_IN_TABLE');
    return session.room.act(session.playerId, handNumber, action);
  });

  on('game:rebuy', rebuyDecisionSchema, () => {
    if (!session) return fail('NOT_IN_TABLE');
    return session.room.rebuy(session.playerId);
  });

  on('game:spectate', rebuyDecisionSchema, () => {
    if (!session) return fail('NOT_IN_TABLE');
    return session.room.spectate(session.playerId);
  });

  socket.on('disconnect', () => {
    if (!session) return;
    session.room.disconnected(session.playerId, connection);
    session = null;
  });
}
