import { Pipe, type PipeTransform } from '@angular/core';
import type { ActionType, Cents, HandCategory } from '@solo-poker/engine';
import type { ClientError } from './socket.service';

// ─── Dinero ─────────────────────────────────────────────────────

const FULL = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const PLAIN = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SHORT = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export type MoneyFormat = 'full' | 'plain' | 'short';

/**
 * - full: "10,00 €" (por defecto)
 * - plain: "10,00", para botones y fichas
 * - short: "10 €", sin decimales si son euros enteros
 */
export function formatMoney(cents: Cents, format: MoneyFormat = 'full'): string {
  const euros = cents / 100;
  if (format === 'plain') return PLAIN.format(euros);
  if (format === 'short') return SHORT.format(euros);
  return FULL.format(euros);
}

@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(cents: Cents | null | undefined, format: MoneyFormat = 'full'): string {
    return cents == null ? '' : formatMoney(cents, format);
  }
}

// ─── Recompras ──────────────────────────────────────────────────

export function minutesLabel(minutes: number): string {
  return minutes < 60 || minutes % 60 !== 0 ? `${minutes} min` : `${minutes / 60} h`;
}

/** "Sin recompras", "1 recompra · durante 1 h", "Recompras ilimitadas · toda la partida"… */
export function rebuyRulesLabel(max: number | null, untilMinutes: number | null): string {
  if (max === 0) return 'Sin recompras';
  const count = max === null ? 'Recompras ilimitadas' : `${max} ${max === 1 ? 'recompra' : 'recompras'}`;
  return `${count} · ${untilMinutes === null ? 'toda la partida' : `durante ${minutesLabel(untilMinutes)}`}`;
}

// ─── Jerga de póker (en inglés) ─────────────────────────────────

export const HAND_LABELS: Record<HandCategory, string> = {
  highCard: 'High Card',
  pair: 'Pair',
  twoPair: 'Two Pair',
  threeOfAKind: 'Three of a Kind',
  straight: 'Straight',
  flush: 'Flush',
  fullHouse: 'Full House',
  fourOfAKind: 'Four of a Kind',
  straightFlush: 'Straight Flush',
};

export const ACTION_LABELS: Record<ActionType, string> = {
  fold: 'Fold',
  check: 'Check',
  call: 'Call',
  raise: 'Raise',
};

// ─── Errores ────────────────────────────────────────────────────

const ERROR_MESSAGES: Record<ClientError, string> = {
  INVALID_PAYLOAD: 'Revisa los datos del formulario.',
  TABLE_NOT_FOUND: 'Esa mesa no existe o ya ha terminado.',
  WRONG_PASSWORD: 'La clave no es correcta.',
  INVALID_TOKEN: 'Tu sesión en esta mesa ha caducado.',
  NOT_IN_TABLE: 'No estás sentado en esta mesa.',
  ALREADY_IN_TABLE: 'Ya estás en otra mesa. Sal de ella primero.',
  STALE_HAND: 'Esa mano ya ha terminado.',
  RATE_LIMITED: 'Demasiados intentos. Espera un minuto.',
  SERVER_FULL: 'El servidor está lleno. Inténtalo más tarde.',
  INTERNAL_ERROR: 'Algo ha fallado en el servidor.',
  NETWORK_ERROR: 'No hay conexión con el servidor.',
  GAME_NOT_WAITING: 'La partida ya ha empezado.',
  GAME_NOT_PLAYING: 'La partida no está en curso.',
  TABLE_FULL: 'La mesa está llena.',
  INVALID_NICKNAME: 'El nombre debe tener entre 1 y 20 caracteres.',
  NICKNAME_TAKEN: 'Ese nombre ya lo usa otro jugador de la mesa.',
  INVALID_AVATAR: 'Elige un icono válido.',
  AVATAR_TAKEN: 'Ese icono ya lo lleva otro jugador. Elige otro.',
  PLAYER_ALREADY_SEATED: 'Ya estás sentado en esta mesa.',
  PLAYER_NOT_FOUND: 'Jugador no encontrado.',
  NOT_ENOUGH_PLAYERS: 'Faltan jugadores.',
  HAND_IN_PROGRESS: 'Hay una mano en curso.',
  NO_HAND_IN_PROGRESS: 'No hay ninguna mano en curso.',
  NOT_YOUR_TURN: 'No es tu turno.',
  ILLEGAL_ACTION: 'Esa acción no está permitida ahora.',
  INVALID_AMOUNT: 'Cantidad no válida.',
  REBUY_NOT_ALLOWED: 'Ya no puedes recomprar.',
  WAITING_FOR_REBUY: 'Esperando a que un jugador decida si recompra.',
};

export const errorMessage = (error: ClientError): string => ERROR_MESSAGES[error];
