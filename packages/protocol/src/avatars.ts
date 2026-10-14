/*
 * Icono de un jugador, guardado como texto:
 *   "e:🦊"    → un emoji (lo dibuja la fuente del sistema, no pesa nada)
 *   "p:spade" → un icono predeterminado de la app (SVG plano)
 *
 * Para añadir un predeterminado: añade su id aquí y su dibujo en la web
 * (apps/web/src/app/ui/avatar-presets.ts).
 */

export const AVATAR_PRESET_IDS = [
  'spade',
  'heart',
  'diamond',
  'club',
  'crown',
  'star',
  'moon',
  'sun',
  'bolt',
  'flame',
  'chip',
  'dice',
] as const;

export type AvatarPresetId = (typeof AVATAR_PRESET_IDS)[number];

const MAX_AVATAR_LENGTH = 32;
const EMOJI_START = /^(\p{Extended_Pictographic}|\p{Regional_Indicator})/u;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Un único emoji (incluye variantes de tono de piel, banderas y combinaciones con ZWJ). */
export function isSingleEmoji(value: string): boolean {
  const graphemes = [...segmenter.segment(value)];
  return graphemes.length === 1 && EMOJI_START.test(value);
}

export function isValidAvatar(avatar: string): boolean {
  if (avatar.length > MAX_AVATAR_LENGTH) return false;
  if (avatar.startsWith('p:')) return (AVATAR_PRESET_IDS as readonly string[]).includes(avatar.slice(2));
  if (avatar.startsWith('e:')) return isSingleEmoji(avatar.slice(2));
  return false;
}

export const presetAvatar = (id: AvatarPresetId): string => `p:${id}`;
export const emojiAvatar = (emoji: string): string => `e:${emoji}`;
