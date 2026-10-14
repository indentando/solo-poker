import { Injectable, signal } from '@angular/core';
import type { ClientToServerEvents, ServerError, ServerToClientEvents } from '@solo-poker/protocol';
import { io, type Socket } from 'socket.io-client';

/**
 * URL del servidor. `undefined` = mismo origen: en desarrollo, el proxy de
 * `ng serve` reenvía /socket.io al servidor en el puerto 3000.
 */
const SERVER_URL: string | undefined = undefined;
const REQUEST_TIMEOUT_MS = 8_000;

export type PokerSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type ClientError = ServerError | 'NETWORK_ERROR';

type RequestEvent = keyof ClientToServerEvents;
type PayloadOf<E extends RequestEvent> = Parameters<ClientToServerEvents[E]>[0];
type ResponseOf<E extends RequestEvent> = Parameters<Parameters<ClientToServerEvents[E]>[1]>[0];

@Injectable({ providedIn: 'root' })
export class SocketService {
  readonly socket: PokerSocket = io(SERVER_URL, { transports: ['websocket'] });
  readonly connected = signal(this.socket.connected);

  constructor() {
    this.socket.on('connect', () => this.connected.set(true));
    this.socket.on('disconnect', () => this.connected.set(false));
  }

  /** Envía una petición y espera el ack. Nunca lanza: los fallos de red vuelven como `NETWORK_ERROR`. */
  async request<E extends RequestEvent>(
    event: E,
    payload: PayloadOf<E>,
  ): Promise<ResponseOf<E> | { ok: false; error: 'NETWORK_ERROR' }> {
    const socket = this.socket.timeout(REQUEST_TIMEOUT_MS) as unknown as {
      emitWithAck(event: E, payload: PayloadOf<E>): Promise<ResponseOf<E>>;
    };
    try {
      return await socket.emitWithAck(event, payload);
    } catch {
      return { ok: false, error: 'NETWORK_ERROR' };
    }
  }
}
