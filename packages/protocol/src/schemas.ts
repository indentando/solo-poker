import { z } from 'zod';
import { LIMITS, isValidAvatar, normalizeTableId } from './index';

/*
 * Validación de todo lo que llega del cliente. Solo lo usa el servidor:
 * va en un subpath aparte (`@solo-poker/protocol/schemas`) para que el
 * frontend no cargue zod.
 */

const tableId = z.string().transform((value, ctx) => {
  const id = normalizeTableId(value);
  if (!id) {
    ctx.addIssue({ code: 'custom', message: 'Invalid table id' });
    return z.NEVER;
  }
  return id;
});
const nickname = z.string().trim().min(1).max(LIMITS.maxNickname);
const password = z.string().min(LIMITS.minPassword).max(LIMITS.maxPassword);
const avatar = z.string().refine(isValidAvatar, 'Invalid avatar');

export const createTableSchema = z.object({
  nickname,
  avatar,
  password,
  maxPlayers: z.number().int().min(LIMITS.minPlayers).max(LIMITS.maxPlayers),
  buyIn: z.number().int().min(LIMITS.minBuyIn).max(LIMITS.maxBuyIn),
  rebuys: z.object({
    max: z.number().int().min(0).max(LIMITS.maxRebuys).nullable(),
    untilMinutes: z.number().int().min(LIMITS.minRebuyMinutes).max(LIMITS.maxRebuyMinutes).nullable(),
  }),
});

export const tableInfoSchema = z.object({ tableId });

export const joinTableSchema = z.object({ tableId, password, nickname, avatar });

export const rejoinTableSchema = z.object({ tableId, token: z.string().min(1).max(100) });

export const leaveTableSchema = z.object({});

export const rebuyDecisionSchema = z.object({});

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fold') }),
  z.object({ type: z.literal('check') }),
  z.object({ type: z.literal('call') }),
  z.object({ type: z.literal('raise'), to: z.number().int().positive() }),
]);

export const gameActionSchema = z.object({
  /** Evita que un clic tardío de la mano anterior se aplique a la nueva. */
  handNumber: z.number().int().positive(),
  action: actionSchema,
});
