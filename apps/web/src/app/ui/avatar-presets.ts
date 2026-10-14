import {
  AVATAR_PRESET_IDS,
  emojiAvatar,
  isValidAvatar,
  presetAvatar,
  type AvatarPresetId,
} from '@solo-poker/protocol';

/*
 * Iconos predeterminados: SVG planos de 24×24 dibujados a mano, sin ficheros
 * externos. Para añadir uno, crea su entrada aquí y su id en
 * packages/protocol/src/avatars.ts.
 */

export interface AvatarPreset {
  label: string;
  color: string;
  paths: string[];
  /** Los trazos que se solapan hacen agujeros (fichas, dados…). */
  evenOdd?: boolean;
}

const WHITE = '#ffffff';
const RED = 'var(--color-suit-red)';
const YELLOW = 'var(--color-chip)';

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;

const sunRays = Array.from({ length: 8 }, (_, i) => {
  const angle = (i * Math.PI) / 4;
  return circle(12 + 8.6 * Math.cos(angle), 12 + 8.6 * Math.sin(angle), 1.4);
});

export const AVATAR_PRESETS: Record<AvatarPresetId, AvatarPreset> = {
  spade: {
    label: 'Picas',
    color: WHITE,
    paths: [
      'M12 2.5C9 6.5 3.5 9.6 3.5 13.6c0 2.5 2 4.4 4.4 4.4 1.4 0 2.6-.6 3.3-1.6L10 21.5h4l-1.2-5.1c.7 1 1.9 1.6 3.3 1.6 2.4 0 4.4-1.9 4.4-4.4 0-4-5.5-7.1-8.5-11.1z',
    ],
  },
  heart: {
    label: 'Corazones',
    color: RED,
    paths: [
      'M12 20.5C6 16 2.5 12.6 2.5 8.7c0-2.8 2.2-4.9 4.9-4.9 1.9 0 3.6 1 4.6 2.6 1-1.6 2.7-2.6 4.6-2.6 2.7 0 4.9 2.1 4.9 4.9 0 3.9-3.5 7.3-9.5 11.8z',
    ],
  },
  diamond: {
    label: 'Diamantes',
    color: RED,
    paths: ['M12 2.5 19.5 12 12 21.5 4.5 12z'],
  },
  club: {
    label: 'Tréboles',
    color: WHITE,
    paths: [circle(12, 7.2, 3.8), circle(7.2, 13.4, 3.8), circle(16.8, 13.4, 3.8), 'M10.7 12h2.6l1.3 9.5H9.4z'],
  },
  crown: {
    label: 'Corona',
    color: YELLOW,
    paths: ['M3 7.5l4.6 4.1L12 4.5l4.4 7.1L21 7.5 19 19H5z'],
  },
  star: {
    label: 'Estrella',
    color: WHITE,
    paths: ['M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z'],
  },
  moon: {
    label: 'Luna',
    color: WHITE,
    paths: ['M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z'],
  },
  sun: {
    label: 'Sol',
    color: YELLOW,
    paths: [circle(12, 12, 4.6), ...sunRays],
  },
  bolt: {
    label: 'Rayo',
    color: YELLOW,
    paths: ['M13.5 2 5 13.5h6L10 22l9-12h-6.2z'],
  },
  flame: {
    label: 'Llama',
    color: RED,
    paths: [
      'M12 22c-4.1 0-7-2.9-7-6.8 0-3.6 2.6-5.6 3.9-8.5.4 1.9 1.4 3 2.6 3.6-.3-3.3 1.1-6.3 3.9-8.3-.1 3.2 1.4 5 2.8 6.8 1.2 1.7 1.8 3.2 1.8 6.4 0 3.9-2.9 6.8-7 6.8z',
    ],
  },
  chip: {
    label: 'Ficha',
    color: YELLOW,
    evenOdd: true,
    paths: [
      circle(12, 12, 9.5),
      circle(12, 12, 6.2),
      circle(12, 12, 3.6),
      'M11 3h2v2.5h-2z',
      'M11 18.5h2V21h-2z',
      'M3 11h2.5v2H3z',
      'M18.5 11H21v2h-2.5z',
    ],
  },
  dice: {
    label: 'Dado',
    color: WHITE,
    evenOdd: true,
    paths: [
      'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z',
      circle(8, 8, 1.6),
      circle(16, 8, 1.6),
      circle(12, 12, 1.6),
      circle(8, 16, 1.6),
      circle(16, 16, 1.6),
    ],
  },
};

/** Emojis ofrecidos en el selector. Cualquier otro se puede escribir a mano. */
export const EMOJI_CHOICES = [
  '🦊', '🐼', '🐨', '🐯', '🦁', '🐸', '🐵', '🐙',
  '🦉', '🐻', '🐰', '🐶', '🐱', '🐷', '🐧', '🦄',
  '🐝', '🦋', '🐢', '🦖', '🐳', '🦈', '🦀', '🐌',
  '😎', '🤠', '🥸', '🤖', '👻', '👽', '💀', '🤡',
  '🍀', '🌵', '🍕', '🍩', '🎩', '🚀', '💎', '🎯',
];

export const PRESET_AVATARS = AVATAR_PRESET_IDS.map(presetAvatar);
export const EMOJI_AVATARS = EMOJI_CHOICES.map(emojiAvatar);

export function presetOf(avatar: string): AvatarPreset | null {
  return avatar.startsWith('p:') ? (AVATAR_PRESETS[avatar.slice(2) as AvatarPresetId] ?? null) : null;
}

/** Tu icono preferido si está libre y es válido; si no, uno al azar que nadie de la mesa lleve. */
export function pickAvatar(preferred: string | undefined, taken: readonly string[]): string {
  if (preferred && isValidAvatar(preferred) && !taken.includes(preferred)) return preferred;
  const free = [...PRESET_AVATARS, ...EMOJI_AVATARS].filter((a) => !taken.includes(a));
  return free[Math.floor(Math.random() * free.length)] ?? PRESET_AVATARS[0]!;
}
