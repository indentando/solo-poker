import {
  addPlayer,
  applyAction,
  createTable,
  getPlayerView,
  handleTimeout,
  removePlayer,
  setConnected,
  standardBlindStructure,
  startGame,
  startHand,
  type Action,
  type GameEvent,
  type PlayerId,
  type PlayerView,
  type Result,
  type Rng,
  type TableState,
} from '@solo-poker/engine';
import type { Ack, Session, TableInfo } from '@solo-poker/protocol';
import { generatePlayerId, generateToken, verifyPassword } from './security';

/** Lo que la sala necesita de una conexión. Desacopla la lógica de Socket.IO (y facilita los tests). */
export interface Connection {
  sendView(view: PlayerView): void;
  sendEvents(events: GameEvent[]): void;
  sendCountdown(startsAt: number | null): void;
  /** Otra conexión ha tomado esta sesión: avisar al cliente y cerrar. */
  replace(): void;
}

export interface RoomTimings {
  turnTimeoutMs: number;
  /** Tiempo para reconectar antes de ser eliminado (bloqueo de pantalla, pérdida de cobertura…). */
  reconnectGraceMs: number;
  /** Cuenta atrás desde que la mesa se llena hasta la primera mano. */
  startDelayMs: number;
  /** Pausa entre manos para ver el resultado. */
  handPauseMs: number;
}

export const DEFAULT_TIMINGS: RoomTimings = {
  turnTimeoutMs: 30_000,
  reconnectGraceMs: 45_000,
  startDelayMs: 3_000,
  handPauseMs: 5_000,
};

const FINISHED_TTL_MS = 10 * 60_000;
const ABANDONED_TTL_MS = 30 * 60_000;

export interface RoomOptions {
  id: string;
  passwordHash: string;
  maxPlayers: number;
  buyIn: number;
  timings: RoomTimings;
  rng: Rng;
  now: () => number;
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * Una mesa en marcha. Guarda el estado del motor, las conexiones de cada
 * jugador y los temporizadores (cuenta atrás, turno, pausa entre manos y
 * margen de reconexión). Cada cambio de estado pasa por `commit`, que envía
 * a cada jugador su propia vista.
 */
export class TableRoom {
  readonly id: string;
  lastActivityAt: number;

  private state: TableState;
  private readonly passwordHash: string;
  private readonly timings: RoomTimings;
  private readonly rng: Rng;
  private readonly now: () => number;

  private readonly tokens = new Map<string, PlayerId>();
  private readonly connections = new Map<PlayerId, Connection>();
  private readonly graceTimers = new Map<PlayerId, Timer>();
  private turnTimer: Timer | null = null;
  private phaseTimer: Timer | null = null;
  private countdownAt: number | null = null;

  constructor(opts: RoomOptions) {
    this.id = opts.id;
    this.passwordHash = opts.passwordHash;
    this.timings = opts.timings;
    this.rng = opts.rng;
    this.now = opts.now;
    this.lastActivityAt = opts.now();
    this.state = createTable({
      id: opts.id,
      maxPlayers: opts.maxPlayers,
      buyIn: opts.buyIn,
      blindStructure: standardBlindStructure(opts.buyIn),
      turnTimeoutMs: opts.timings.turnTimeoutMs,
    });
  }

  get snapshot(): TableState {
    return this.state;
  }

  get info(): TableInfo {
    return {
      tableId: this.id,
      status: this.state.status,
      players: this.state.players.length,
      maxPlayers: this.state.config.maxPlayers,
      buyIn: this.state.config.buyIn,
      takenAvatars: this.state.players.map((p) => p.avatar),
    };
  }

  checkPassword(password: string): Promise<boolean> {
    return verifyPassword(password, this.passwordHash);
  }

  // ─── Operaciones de los jugadores ─────────────────────────────

  join(connection: Connection, nickname: string, avatar: string): Ack<Session> {
    const playerId = generatePlayerId();
    const result = addPlayer(this.state, { id: playerId, nickname, avatar });
    if (!result.ok) return { ok: false, error: result.error };

    const token = generateToken();
    this.tokens.set(token, playerId);
    this.connections.set(playerId, connection);
    this.commit(result);
    return { ok: true, tableId: this.id, playerId, token };
  }

  rejoin(connection: Connection, token: string): Ack<Session> {
    const playerId = this.tokens.get(token);
    if (!playerId) return { ok: false, error: 'INVALID_TOKEN' };

    const previous = this.connections.get(playerId);
    this.connections.set(playerId, connection);
    if (previous && previous !== connection) previous.replace();
    this.clearGrace(playerId);

    const player = this.state.players.find((p) => p.id === playerId);
    if (player && !player.connected) this.commit(setConnected(this.state, playerId, true));
    else this.sendTo(playerId);
    if (this.countdownAt !== null) connection.sendCountdown(this.countdownAt);

    return { ok: true, tableId: this.id, playerId, token };
  }

  leave(playerId: PlayerId): Ack {
    this.forget(playerId);
    return this.commit(removePlayer(this.state, playerId, this.now()));
  }

  act(playerId: PlayerId, handNumber: number, action: Action): Ack {
    if (this.state.hand?.number !== handNumber) return { ok: false, error: 'STALE_HAND' };
    return this.commit(applyAction(this.state, playerId, action, this.now()));
  }

  disconnected(playerId: PlayerId, connection: Connection): void {
    // Si ya la sustituyó otra conexión, esta desconexión no cuenta.
    if (this.connections.get(playerId) !== connection) return;
    this.connections.delete(playerId);

    const player = this.state.players.find((p) => p.id === playerId);
    if (!player || player.status === 'eliminated' || this.state.status === 'finished') return;

    this.commit(setConnected(this.state, playerId, false));
    this.graceTimers.set(
      playerId,
      setTimeout(() => {
        this.graceTimers.delete(playerId);
        this.leave(playerId);
      }, this.timings.reconnectGraceMs),
    );
  }

  // ─── Ciclo de vida ────────────────────────────────────────────

  canBeDeleted(now: number): boolean {
    if (this.state.players.length === 0) return true;
    const idle = now - this.lastActivityAt;
    if (this.state.status === 'finished') return idle > FINISHED_TTL_MS;
    return this.connections.size === 0 && idle > ABANDONED_TTL_MS;
  }

  dispose(): void {
    this.clearTurnTimer();
    this.clearPhaseTimer();
    for (const timer of this.graceTimers.values()) clearTimeout(timer);
    this.graceTimers.clear();
  }

  // ─── Internos ─────────────────────────────────────────────────

  private commit(result: Result): Ack {
    if (!result.ok) return { ok: false, error: result.error };
    this.state = result.state;
    this.lastActivityAt = this.now();
    for (const playerId of this.connections.keys()) this.sendTo(playerId, result.events);
    this.schedule();
    return { ok: true };
  }

  /** Cada jugador recibe SU vista: nunca se hace broadcast del estado. */
  private sendTo(playerId: PlayerId, events: GameEvent[] = []): void {
    const connection = this.connections.get(playerId);
    if (!connection) return;
    if (events.length > 0) connection.sendEvents(events);
    connection.sendView(getPlayerView(this.state, playerId));
  }

  /** Programa el siguiente paso automático según el estado actual. */
  private schedule(): void {
    this.clearTurnTimer();
    const { status, hand, players, config } = this.state;

    if (status === 'waiting') {
      const full = players.length === config.maxPlayers;
      if (full && !this.phaseTimer) {
        this.setCountdown(this.now() + this.timings.startDelayMs);
        this.phaseTimer = setTimeout(() => {
          this.phaseTimer = null;
          this.countdownAt = null;
          this.commit(startGame(this.state, this.rng, this.now()));
        }, this.timings.startDelayMs);
      } else if (!full && this.phaseTimer) {
        // Alguien se fue durante la cuenta atrás.
        this.clearPhaseTimer();
        this.setCountdown(null);
      }
      return;
    }

    if (status === 'finished') {
      this.clearPhaseTimer();
      return;
    }

    if (hand && !hand.finished) {
      if (hand.turnDeadline !== null) {
        this.turnTimer = setTimeout(
          () => {
            this.turnTimer = null;
            this.commit(handleTimeout(this.state, this.now()));
          },
          Math.max(0, hand.turnDeadline - this.now()),
        );
      }
      return;
    }

    // Partida en marcha y sin mano activa: la primera se reparte ya, las demás tras una pausa.
    if (!hand) {
      this.dealNextHand();
    } else if (!this.phaseTimer) {
      this.phaseTimer = setTimeout(() => {
        this.phaseTimer = null;
        this.dealNextHand();
      }, this.timings.handPauseMs);
    }
  }

  private dealNextHand(): void {
    this.commit(startHand(this.state, { rng: this.rng, now: this.now() }));
  }

  private setCountdown(startsAt: number | null): void {
    this.countdownAt = startsAt;
    for (const connection of this.connections.values()) connection.sendCountdown(startsAt);
  }

  private forget(playerId: PlayerId): void {
    this.connections.delete(playerId);
    this.clearGrace(playerId);
    for (const [token, id] of this.tokens) if (id === playerId) this.tokens.delete(token);
  }

  private clearGrace(playerId: PlayerId): void {
    const timer = this.graceTimers.get(playerId);
    if (timer) clearTimeout(timer);
    this.graceTimers.delete(playerId);
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
  }

  private clearPhaseTimer(): void {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phaseTimer = null;
    this.countdownAt = null;
  }
}
