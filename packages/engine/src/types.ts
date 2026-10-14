/** Importe en céntimos de euro. Siempre entero: 1000 = 10,00 €. */
export type Cents = number;
export type PlayerId = string;

export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
export type Suit = 'c' | 'd' | 'h' | 's';
export type Card = `${Rank}${Suit}`;

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export type HandCategory =
  | 'highCard'
  | 'pair'
  | 'twoPair'
  | 'threeOfAKind'
  | 'straight'
  | 'flush'
  | 'fullHouse'
  | 'fourOfAKind'
  | 'straightFlush';

/** Devuelve un entero aleatorio en [0, maxExclusive). Se inyecta para poder testear. */
export type Rng = (maxExclusive: number) => number;

// ─── Configuración ──────────────────────────────────────────────

export interface BlindLevel {
  sb: Cents;
  bb: Cents;
  ante?: Cents;
}

export interface BlindStructure {
  levels: BlindLevel[];
  increaseEvery: { type: 'minutes' | 'hands'; value: number };
}

export interface TableConfig {
  id: string;
  maxPlayers: number;
  buyIn: Cents;
  blindStructure: BlindStructure;
  turnTimeoutMs: number;
}

// ─── Estado ─────────────────────────────────────────────────────

export interface Player {
  id: PlayerId;
  nickname: string;
  /** Icono del jugador ("e:🦊" o "p:spade"). El formato lo valida el protocolo; el motor exige que sea único. */
  avatar: string;
  seat: number;
  stack: Cents;
  status: 'active' | 'eliminated';
  connected: boolean;
}

export type SeatState = 'active' | 'folded' | 'allIn';

export interface HandSeat {
  state: SeatState;
  betThisStreet: Cents;
  /** Total aportado en la mano (antes + apuestas). Base para calcular los side pots. */
  totalContributed: Cents;
  hasActed: boolean;
  lastAction: ActionType | null;
}

export interface PotResult {
  amount: Cents;
  winners: PlayerId[];
  /** null si la mano se ganó sin showdown (todos los demás se retiraron). */
  category: HandCategory | null;
}

export interface HandState {
  number: number;
  /** Jugadores que reciben cartas, en orden de asiento. */
  order: PlayerId[];
  buttonId: PlayerId;
  sbId: PlayerId;
  bbId: PlayerId;
  /** SOLO servidor. */
  deck: Card[];
  /** SOLO servidor. */
  holeCards: Record<PlayerId, [Card, Card]>;
  board: Card[];
  street: Street;
  seats: Record<PlayerId, HandSeat>;
  /** Apuesta más alta de la calle actual. */
  currentBet: Cents;
  /** Tamaño de la última subida completa: la siguiente debe ser al menos igual. */
  minRaise: Cents;
  toAct: PlayerId | null;
  turnDeadline: number | null;
  /** true cuando las cartas de los jugadores vivos se muestran (showdown o all-in). */
  revealed: boolean;
  finished: boolean;
  results: PotResult[];
}

export interface TableState {
  config: TableConfig;
  status: 'waiting' | 'playing' | 'finished';
  /** Ordenados por asiento. */
  players: Player[];
  buttonSeat: number;
  blindLevel: number;
  /** Timestamp (si las ciegas suben por minutos) o nº de mano (si suben por manos). */
  levelStartedAt: number;
  handNumber: number;
  hand: HandState | null;
  winnerId: PlayerId | null;
}

// ─── Acciones ───────────────────────────────────────────────────

export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  /** Subir HASTA `to` (apuesta total en la calle), no "subir `to` más". */
  | { type: 'raise'; to: Cents };

export type ActionType = Action['type'];

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  /** 0 si no hay nada que igualar. Si no cubre la apuesta, es su all-in. */
  callAmount: Cents;
  /** null si no puede subir. `max` equivale a ir all-in. */
  raise: { min: Cents; max: Cents } | null;
}

// ─── Eventos (para animar en el cliente) ────────────────────────

export type GameEvent =
  | { type: 'playerJoined'; playerId: PlayerId; nickname: string; avatar: string; seat: number }
  | { type: 'playerLeft'; playerId: PlayerId }
  | { type: 'playerConnection'; playerId: PlayerId; connected: boolean }
  | { type: 'gameStarted'; buttonSeat: number }
  | { type: 'handStarted'; handNumber: number; buttonSeat: number }
  | {
      type: 'blindsPosted';
      sb: { playerId: PlayerId; amount: Cents };
      bb: { playerId: PlayerId; amount: Cents };
      ante: Cents;
    }
  | { type: 'blindsIncreased'; level: number; sb: Cents; bb: Cents }
  | { type: 'playerActed'; playerId: PlayerId; action: Action; amount: Cents; allIn: boolean }
  | { type: 'turnTimedOut'; playerId: PlayerId }
  | { type: 'uncalledReturned'; playerId: PlayerId; amount: Cents }
  | { type: 'streetDealt'; street: Street; cards: Card[] }
  | { type: 'showdown'; reveals: Record<PlayerId, [Card, Card]> }
  | ({ type: 'potAwarded' } & PotResult)
  | { type: 'playerEliminated'; playerId: PlayerId }
  | { type: 'gameOver'; winnerId: PlayerId | null };

// ─── Resultado de las operaciones ───────────────────────────────

export type EngineError =
  | 'GAME_NOT_WAITING'
  | 'GAME_NOT_PLAYING'
  | 'TABLE_FULL'
  | 'INVALID_NICKNAME'
  | 'NICKNAME_TAKEN'
  | 'INVALID_AVATAR'
  | 'AVATAR_TAKEN'
  | 'PLAYER_ALREADY_SEATED'
  | 'PLAYER_NOT_FOUND'
  | 'NOT_ENOUGH_PLAYERS'
  | 'HAND_IN_PROGRESS'
  | 'NO_HAND_IN_PROGRESS'
  | 'NOT_YOUR_TURN'
  | 'ILLEGAL_ACTION'
  | 'INVALID_AMOUNT';

export type Result =
  | { ok: true; state: TableState; events: GameEvent[] }
  | { ok: false; error: EngineError };

// ─── Vista filtrada para cada jugador ───────────────────────────

export interface PlayerView {
  tableId: string;
  status: TableState['status'];
  maxPlayers: number;
  buyIn: Cents;
  handNumber: number;
  buttonSeat: number;
  winnerId: PlayerId | null;
  blinds: BlindLevel & {
    level: number;
    nextLevelAt: { type: 'minutes' | 'hands'; at: number } | null;
  };
  players: {
    id: PlayerId;
    nickname: string;
    avatar: string;
    seat: number;
    stack: Cents;
    status: Player['status'];
    connected: boolean;
    handState: SeatState | null;
    betThisStreet: Cents;
    lastAction: ActionType | null;
    /** Solo visibles en el showdown (o all-in sin más apuestas posibles). */
    holeCards: [Card, Card] | null;
  }[];
  board: Card[];
  street: Street | null;
  potTotal: Cents;
  toAct: PlayerId | null;
  turnDeadline: number | null;
  turnTimeoutMs: number;
  /** Resultado de la última mano, mientras no empiece la siguiente. */
  results: PotResult[] | null;
  you: {
    id: PlayerId;
    holeCards: [Card, Card] | null;
    handCategory: HandCategory | null;
    /** null si no es tu turno. */
    legal: LegalActions | null;
  } | null;
}
