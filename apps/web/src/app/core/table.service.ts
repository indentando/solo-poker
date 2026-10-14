import { Injectable, computed, inject, signal } from '@angular/core';
import type { Action, GameEvent, PlayerView } from '@solo-poker/engine';
import type { CreateTablePayload, JoinTablePayload, Session } from '@solo-poker/protocol';
import { Subject } from 'rxjs';
import { SocketService } from './socket.service';
import { clearSession, loadSession, saveSession } from './storage';

/**
 * Estado de la mesa en la que está el jugador. El servidor es la única fuente
 * de verdad: aquí solo se guarda la última vista recibida y se envían acciones.
 */
@Injectable({ providedIn: 'root' })
export class TableService {
  private readonly sockets = inject(SocketService);
  private readonly socket = this.sockets.socket;
  /** Hora del servidor menos hora local. */
  private clockOffset = 0;

  readonly connected = this.sockets.connected;
  readonly session = signal<Session | null>(null);
  readonly view = signal<PlayerView | null>(null);
  /** Inicio de la partida en hora local, o null si no hay cuenta atrás. */
  readonly countdownAt = signal<number | null>(null);
  /** La sesión se ha abierto en otra pestaña o dispositivo. */
  readonly replaced = signal(false);
  /** Lo que acaba de pasar, para animaciones y avisos. */
  readonly events = new Subject<GameEvent[]>();

  readonly me = computed(() => {
    const view = this.view();
    return view?.players.find((p) => p.id === view.you?.id) ?? null;
  });

  constructor() {
    // Un socket solo puede estar en una mesa, así que toda vista recibida es de la nuestra.
    // (La primera llega antes que el ack de create/join, por eso no se filtra por sesión.)
    this.socket.on('table:view', (view, serverNow) => {
      this.clockOffset = serverNow - Date.now();
      this.view.set(view);
    });
    this.socket.on('game:events', (events) => this.events.next(events));
    this.socket.on('table:countdown', ({ startsAt, serverNow }) => {
      this.countdownAt.set(startsAt === null ? null : startsAt - (serverNow - Date.now()));
    });
    this.socket.on('session:replaced', () => this.replaced.set(true));
    // Tras un corte de conexión, el servidor ve un socket nuevo: hay que volver a sentarse.
    this.socket.on('connect', () => {
      const session = this.session();
      if (session && !this.replaced()) void this.rejoin(session.tableId);
    });
  }

  /** Convierte una hora del servidor a la hora local. */
  toLocalTime(serverTime: number): number {
    return serverTime - this.clockOffset;
  }

  info(tableId: string) {
    return this.sockets.request('table:info', { tableId });
  }

  async create(payload: CreateTablePayload) {
    const result = await this.sockets.request('table:create', payload);
    if (result.ok) this.enter(result);
    return result;
  }

  async join(payload: JoinTablePayload) {
    const result = await this.sockets.request('table:join', payload);
    if (result.ok) this.enter(result);
    return result;
  }

  /** Vuelve a sentarse con el token guardado, sin pedir la clave. */
  async rejoin(tableId: string) {
    const stored = loadSession(tableId);
    if (!stored) return { ok: false, error: 'INVALID_TOKEN' } as const;

    const result = await this.sockets.request('table:rejoin', { tableId, token: stored.token });
    if (result.ok) {
      this.enter(result);
    } else if (result.error === 'INVALID_TOKEN' || result.error === 'TABLE_NOT_FOUND') {
      // Ya no tenemos sitio en esa mesa (expiró el margen de reconexión o la mesa se cerró).
      clearSession(tableId);
      if (this.session()?.tableId === tableId) this.reset();
    }
    return result;
  }

  /** Abandona la mesa. Con la partida empezada, el jugador queda eliminado. */
  async leave(): Promise<void> {
    const session = this.session();
    if (session) {
      await this.sockets.request('table:leave', {});
      clearSession(session.tableId);
    }
    this.reset();
  }

  act(action: Action) {
    const view = this.view();
    return this.sockets.request('game:action', { handNumber: view?.handNumber ?? 0, action });
  }

  /** Recupera la sesión que se abrió en otro sitio (y la cierra allí). */
  takeOver(): void {
    this.replaced.set(false);
    if (this.socket.connected) {
      const session = this.session();
      if (session) void this.rejoin(session.tableId);
    } else {
      this.socket.connect(); // el handler de 'connect' se encarga de volver a sentarse
    }
  }

  private enter(session: Session): void {
    saveSession(session);
    this.session.set(session);
    this.replaced.set(false);
  }

  private reset(): void {
    this.session.set(null);
    this.view.set(null);
    this.countdownAt.set(null);
    this.replaced.set(false);
  }
}
