import type { Action, Cents, EngineError, GameEvent, PlayerView, TableState } from '@solo-poker/engine';

/*
 * Contrato entre cliente y servidor. Todos los mensajes del cliente se envían
 * como `(payload, ack)` y el servidor siempre responde por el ack.
 * Este módulo no tiene dependencias en runtime: lo importa también el frontend.
 * La validación (zod) está en `@solo-poker/protocol/schemas`.
 */

export * from './avatars';

// ─── Identificador de mesa ──────────────────────────────────────

/** Sin caracteres ambiguos (0/O, 1/I/L) para que se pueda dictar o teclear. */
export const TABLE_ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const TABLE_ID_LENGTH = 6;

/** Acepta "k7x92q", "K7X-92Q", "k7x 92q"… y devuelve "K7X-92Q", o null si no es válido. */
export function normalizeTableId(raw: string): string | null {
  const clean = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (clean.length !== TABLE_ID_LENGTH || [...clean].some((c) => !TABLE_ID_ALPHABET.includes(c))) {
    return null;
  }
  return `${clean.slice(0, 3)}-${clean.slice(3)}`;
}

// ─── Límites ────────────────────────────────────────────────────

export const LIMITS = {
  minPlayers: 2,
  maxPlayers: 9,
  minBuyIn: 100, // 1 €
  maxBuyIn: 100_000, // 1.000 €
  minPassword: 4,
  maxPassword: 64,
  maxNickname: 20,
} as const;

// ─── Payloads ───────────────────────────────────────────────────

export interface CreateTablePayload {
  nickname: string;
  /** "e:🦊" o "p:spade" (ver avatars.ts). */
  avatar: string;
  password: string;
  maxPlayers: number;
  buyIn: Cents;
}

export interface TableInfoPayload {
  tableId: string;
}

export interface JoinTablePayload {
  tableId: string;
  password: string;
  nickname: string;
  avatar: string;
}

export interface RejoinTablePayload {
  tableId: string;
  token: string;
}

export interface GameActionPayload {
  handNumber: number;
  action: Action;
}

// ─── Respuestas ─────────────────────────────────────────────────

export type ServerError =
  | EngineError
  | 'INVALID_PAYLOAD'
  | 'TABLE_NOT_FOUND'
  | 'WRONG_PASSWORD'
  | 'INVALID_TOKEN'
  | 'NOT_IN_TABLE'
  | 'ALREADY_IN_TABLE'
  | 'STALE_HAND'
  | 'RATE_LIMITED'
  | 'SERVER_FULL'
  | 'INTERNAL_ERROR';

export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; error: ServerError };

export interface TableInfo {
  tableId: string;
  status: TableState['status'];
  players: number;
  maxPlayers: number;
  buyIn: Cents;
  /** Iconos ya cogidos en la mesa, para no ofrecerlos al unirse. */
  takenAvatars: string[];
}

export interface Session {
  tableId: string;
  playerId: string;
  /** Guardar en localStorage: permite reconectar sin volver a pedir la clave. */
  token: string;
}

// ─── Eventos de Socket.IO ───────────────────────────────────────

type Handler<P, R extends object = object> = (payload: P, ack: (response: Ack<R>) => void) => void;

export interface ClientToServerEvents {
  'table:create': Handler<CreateTablePayload, Session>;
  'table:info': Handler<TableInfoPayload, { table: TableInfo }>;
  'table:join': Handler<JoinTablePayload, Session>;
  'table:rejoin': Handler<RejoinTablePayload, Session>;
  'table:leave': Handler<Record<string, never>>;
  'game:action': Handler<GameActionPayload>;
}

export interface ServerToClientEvents {
  /**
   * Vista completa tras cada cambio. Sustituye a la anterior.
   * `serverNow` permite al cliente corregir el desfase de reloj en los temporizadores.
   */
  'table:view': (view: PlayerView, serverNow: number) => void;
  /** Lo que acaba de pasar, para animar. Llega justo antes de la vista nueva. */
  'game:events': (events: GameEvent[]) => void;
  /** La mesa está llena y la partida empieza en `startsAt` (hora del servidor); null si se cancela. */
  'table:countdown': (payload: { startsAt: number | null; serverNow: number }) => void;
  /** Esta sesión se ha abierto en otra pestaña o dispositivo. */
  'session:replaced': () => void;
}
