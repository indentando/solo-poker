import { currentBlindLevel, getLegalActions } from './engine';
import { evaluateHand } from './evaluator';
import type { PlayerId, PlayerView, TableState } from './types';

/**
 * Lo único que viaja al cliente. Nunca incluye la baraja ni las cartas de los
 * demás jugadores, salvo las que ya se han enseñado en el showdown.
 * Con `playerId` null devuelve la vista de un espectador.
 */
export function getPlayerView(state: TableState, playerId: PlayerId | null): PlayerView {
  const hand = state.hand;
  const level = currentBlindLevel(state);
  const { levels, increaseEvery } = state.config.blindStructure;
  const hasNextLevel = state.status === 'playing' && state.blindLevel < levels.length - 1;

  const me = playerId ? state.players.find((p) => p.id === playerId) : undefined;
  const myCards = me && hand ? (hand.holeCards[me.id] ?? null) : null;

  return {
    tableId: state.config.id,
    status: state.status,
    maxPlayers: state.config.maxPlayers,
    buyIn: state.config.buyIn,
    handNumber: state.handNumber,
    buttonSeat: state.buttonSeat,
    winnerId: state.winnerId,
    blinds: {
      ...level,
      level: state.blindLevel,
      nextLevelAt: hasNextLevel
        ? {
            type: increaseEvery.type,
            at:
              increaseEvery.type === 'minutes'
                ? state.levelStartedAt + increaseEvery.value * 60_000
                : state.levelStartedAt + increaseEvery.value,
          }
        : null,
    },
    players: state.players.map((p) => {
      const seat = hand?.seats[p.id];
      const showCards = hand?.revealed && seat && seat.state !== 'folded';
      return {
        id: p.id,
        nickname: p.nickname,
        avatar: p.avatar,
        seat: p.seat,
        stack: p.stack,
        status: p.status,
        connected: p.connected,
        handState: seat?.state ?? null,
        betThisStreet: seat?.betThisStreet ?? 0,
        lastAction: seat?.lastAction ?? null,
        holeCards: showCards ? hand.holeCards[p.id]! : null,
      };
    }),
    board: hand?.board ?? [],
    street: hand?.street ?? null,
    potTotal: hand && !hand.finished
      ? Object.values(hand.seats).reduce((sum, s) => sum + s.totalContributed, 0)
      : 0,
    toAct: hand?.toAct ?? null,
    turnDeadline: hand?.turnDeadline ?? null,
    turnTimeoutMs: state.config.turnTimeoutMs,
    results: hand?.finished ? hand.results : null,
    you: me
      ? {
          id: me.id,
          holeCards: myCards,
          handCategory: myCards ? evaluateHand([...myCards, ...hand!.board]).category : null,
          legal: getLegalActions(state, me.id),
        }
      : null,
  };
}
