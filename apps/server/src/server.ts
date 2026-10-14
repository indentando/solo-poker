import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Rng } from '@solo-poker/engine';
import { Server } from 'socket.io';
import { RateLimiter, cryptoRng } from './security';
import { registerSocketHandlers, type PokerServer } from './sockets';
import { createStaticHandler } from './static-files';
import { TableManager } from './table-manager';
import { DEFAULT_TIMINGS, type RoomTimings } from './table-room';

export interface PokerServerOptions {
  /** Orígenes permitidos por CORS. `true` acepta cualquiera (útil en desarrollo). */
  corsOrigin?: string[] | boolean;
  timings?: Partial<RoomTimings>;
  rng?: Rng;
  now?: () => number;
  maxTables?: number;
  /** Carpeta con la web compilada. Si se indica, el servidor también sirve la web. */
  staticDir?: string;
}

const SWEEP_INTERVAL_MS = 60_000;

export function createPokerServer(opts: PokerServerOptions = {}) {
  const now = opts.now ?? Date.now;
  const manager = new TableManager({
    timings: { ...DEFAULT_TIMINGS, ...opts.timings },
    rng: opts.rng ?? cryptoRng,
    now,
    maxTables: opts.maxTables ?? 1000,
  });
  const createLimiter = new RateLimiter(5, 60_000, now);
  const joinLimiter = new RateLimiter(10, 60_000, now);

  const serveStatic = opts.staticDir ? createStaticHandler(opts.staticDir) : null;

  // Socket.IO atiende /socket.io/ antes de llegar aquí.
  const httpServer = createServer((req, res) => {
    // Una sola dirección oficial: www.solo-poker.app → solo-poker.app.
    const host = req.headers.host ?? '';
    if (host.startsWith('www.')) {
      res.writeHead(301, { location: `https://${host.slice(4)}${req.url ?? '/'}` }).end();
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ status: 'ok', tables: manager.size }));
      return;
    }
    if (serveStatic?.(req, res)) return;
    res.writeHead(404).end();
  });

  const io: PokerServer = new Server(httpServer, { cors: { origin: opts.corsOrigin ?? true } });
  registerSocketHandlers(io, { manager, createLimiter, joinLimiter });

  const sweeper = setInterval(() => {
    manager.sweep();
    createLimiter.sweep();
    joinLimiter.sweep();
  }, SWEEP_INTERVAL_MS);
  sweeper.unref();

  return {
    httpServer,
    io,
    manager,

    /** Arranca el servidor y devuelve el puerto real (útil con puerto 0). */
    listen(port: number, host = '0.0.0.0'): Promise<number> {
      return new Promise((resolve) => {
        httpServer.listen(port, host, () => resolve((httpServer.address() as AddressInfo).port));
      });
    },

    close(): Promise<void> {
      clearInterval(sweeper);
      manager.dispose();
      return new Promise((resolve) => {
        io.close(() => resolve());
      });
    },
  };
}
