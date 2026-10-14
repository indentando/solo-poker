import { randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { TABLE_ID_ALPHABET, TABLE_ID_LENGTH } from '@solo-poker/protocol';

// ─── Identificadores ────────────────────────────────────────────

export function generateTableId(): string {
  let id = '';
  for (let i = 0; i < TABLE_ID_LENGTH; i++) id += TABLE_ID_ALPHABET[randomInt(TABLE_ID_ALPHABET.length)];
  return `${id.slice(0, 3)}-${id.slice(3)}`;
}

export const generatePlayerId = (): string => randomUUID();

/** Token de sesión: 32 bytes aleatorios, imposible de adivinar por fuerza bruta. */
export const generateToken = (): string => randomBytes(32).toString('base64url');

/** RNG criptográfico para barajar. */
export const cryptoRng = (maxExclusive: number): number => randomInt(maxExclusive);

// ─── Contraseñas de mesa ────────────────────────────────────────

const KEY_LENGTH = 32;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const key = await deriveKey(password, Buffer.from(saltHex, 'hex'));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// ─── Rate limit ─────────────────────────────────────────────────

/** Ventana fija en memoria. Suficiente para un solo proceso. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Devuelve false si `key` ya ha agotado sus intentos en la ventana actual. */
  take(key: string): boolean {
    const now = this.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.limit;
  }

  sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}
