import type { Rng } from '@solo-poker/engine';
import { REBUY_DECISION_MS } from '@solo-poker/protocol';
import { TableRoom, type RoomTimings } from './table-room';
import { generateTableId, hashPassword } from './security';

export interface TableManagerOptions {
  timings: RoomTimings;
  rng: Rng;
  now: () => number;
  maxTables: number;
}

/** Registro en memoria de las mesas activas. */
export class TableManager {
  private readonly rooms = new Map<string, TableRoom>();

  constructor(private readonly opts: TableManagerOptions) {}

  get size(): number {
    return this.rooms.size;
  }

  get(tableId: string): TableRoom | undefined {
    return this.rooms.get(tableId);
  }

  /** Devuelve null si se ha alcanzado el máximo de mesas. */
  async create(input: {
    maxPlayers: number;
    buyIn: number;
    password: string;
    rebuys: { max: number | null; untilMinutes: number | null };
  }): Promise<TableRoom | null> {
    if (this.rooms.size >= this.opts.maxTables) return null;
    const passwordHash = await hashPassword(input.password);

    let id = generateTableId();
    while (this.rooms.has(id)) id = generateTableId();

    const room = new TableRoom({
      id,
      passwordHash,
      maxPlayers: input.maxPlayers,
      buyIn: input.buyIn,
      rebuy: {
        maxPerPlayer: input.rebuys.max,
        untilMinutes: input.rebuys.untilMinutes,
        decisionMs: REBUY_DECISION_MS,
      },
      timings: this.opts.timings,
      rng: this.opts.rng,
      now: this.opts.now,
    });
    this.rooms.set(id, room);
    return room;
  }

  /** Borra mesas vacías, terminadas hace rato o abandonadas. */
  sweep(): void {
    const now = this.opts.now();
    for (const [id, room] of this.rooms) {
      if (room.canBeDeleted(now)) {
        room.dispose();
        this.rooms.delete(id);
      }
    }
  }

  dispose(): void {
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
  }
}
