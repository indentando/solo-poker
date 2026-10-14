import type { Session } from '@solo-poker/protocol';

/*
 * El almacenamiento del navegador puede no estar disponible (modo privado,
 * datos bloqueados…), así que todo va en try/catch y la app funciona igual.
 */

const sessionKey = (tableId: string) => `solo-poker:session:${tableId}`;
const passwordKey = (tableId: string) => `solo-poker:password:${tableId}`;
const PROFILE_KEY = 'solo-poker:profile';

export interface Profile {
  nickname: string;
  avatar: string;
}

/** Último nombre e icono usados, para rellenar los formularios la próxima vez. */
export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Opcional.
  }
}

/** Sesión de jugador: sobrevive a recargas para poder reconectar sin la clave. */
export function loadSession(tableId: string): Session | null {
  try {
    const raw = localStorage.getItem(sessionKey(tableId));
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(sessionKey(session.tableId), JSON.stringify(session));
  } catch {
    // Sin almacenamiento: no se podrá reconectar tras recargar, pero se puede jugar.
  }
}

export function clearSession(tableId: string): void {
  try {
    localStorage.removeItem(sessionKey(tableId));
  } catch {
    // Nada que limpiar.
  }
}

/** Clave de la mesa, solo durante la pestaña: sirve para compartir el enlace con clave. */
export function rememberPassword(tableId: string, password: string): void {
  try {
    sessionStorage.setItem(passwordKey(tableId), password);
  } catch {
    // Opcional.
  }
}

export function recallPassword(tableId: string): string | null {
  try {
    return sessionStorage.getItem(passwordKey(tableId));
  } catch {
    return null;
  }
}
