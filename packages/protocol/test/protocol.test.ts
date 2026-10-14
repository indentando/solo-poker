import { describe, expect, it } from 'vitest';
import { isValidAvatar, normalizeTableId } from '../src';
import { gameActionSchema, joinTableSchema } from '../src/schemas';

describe('isValidAvatar', () => {
  it.each(['e:🦊', 'e:👍🏽', 'e:🇪🇸', 'e:🧑‍🚀', 'p:spade', 'p:chip'])('acepta %s', (avatar) => {
    expect(isValidAvatar(avatar)).toBe(true);
  });

  it.each(['', '🦊', 'e:', 'e:🦊🐼', 'e:a', 'e:<b>', 'p:unknown', 'x:spade', `e:${'🦊'.repeat(20)}`])(
    'rechaza %s',
    (avatar) => {
      expect(isValidAvatar(avatar)).toBe(false);
    },
  );
});

describe('normalizeTableId', () => {
  it('acepta variantes y normaliza al formato XXX-XXX', () => {
    expect(normalizeTableId('k7x92q')).toBe('K7X-92Q');
    expect(normalizeTableId(' K7X-92Q ')).toBe('K7X-92Q');
    expect(normalizeTableId('k7x 92q')).toBe('K7X-92Q');
  });

  it('rechaza longitudes incorrectas y caracteres ambiguos', () => {
    expect(normalizeTableId('K7X-92')).toBeNull();
    expect(normalizeTableId('K0X-92Q')).toBeNull();
    expect(normalizeTableId('KIX-92Q')).toBeNull();
  });
});

describe('esquemas', () => {
  it('normaliza el id y recorta el nickname al unirse', () => {
    expect(
      joinTableSchema.parse({ tableId: 'k7x92q', password: 'abcd', nickname: '  Ana ', avatar: 'p:spade' }),
    ).toEqual({
      tableId: 'K7X-92Q',
      password: 'abcd',
      nickname: 'Ana',
      avatar: 'p:spade',
    });
  });

  it('rechaza acciones mal formadas', () => {
    expect(gameActionSchema.safeParse({ handNumber: 1, action: { type: 'raise', to: 10.5 } }).success).toBe(false);
    expect(gameActionSchema.safeParse({ handNumber: 1, action: { type: 'allin' } }).success).toBe(false);
    expect(gameActionSchema.safeParse({ handNumber: 1, action: { type: 'call' } }).success).toBe(true);
  });
});
