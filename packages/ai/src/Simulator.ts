import { GameEngine } from '../../server/src/game/GameEngine.js';
import type { AIStrategy } from '../../server/src/game/ai/types.js';
import type { PPOStrategy } from './rl/PPOStrategy.js';

export interface AgentEntry {
  id: string;
  name: string;
  strategy: AIStrategy;
}

export interface GameResult {
  winnerId: string;
  winnerName: string;
  turns: number;
  playerStats: Map<string, {
    completeSets: number;
    bankValue: number;
    handSize: number;
  }>;
}

const MAX_ITERATIONS = 3000;

/**
 * Headless game simulator: runs a full Monopoly Deal game
 * with AI agents, no sockets or delays.
 */
export function simulateGame(agents: AgentEntry[]): GameResult | null {
  const players = agents.map(a => ({ id: a.id, name: a.name }));
  const engine = new GameEngine(players);
  const strategyMap = new Map(agents.map(a => [a.id, a.strategy]));

  // Feed discard pile to PPO strategies for card counting
  const feedDiscardPile = (strategy: AIStrategy) => {
    if ('setDiscardPile' in strategy && typeof (strategy as PPOStrategy).setDiscardPile === 'function') {
      (strategy as PPOStrategy).setDiscardPile(engine.getFullDiscardPile());
    }
  };

  let state = engine.getState();
  let iterations = 0;

  while (state.phase !== 'finished' && iterations < MAX_ITERATIONS) {
    iterations++;
    state = engine.getState();
    if (state.phase === 'finished') break;

    const currentId = state.players[state.currentPlayerIndex].id;
    const strategy = strategyMap.get(currentId)!;
    const hand = engine.getHand(currentId);

    if (state.pendingAction) {
      const pa = state.pendingAction;

      if (pa.jsnChain) {
        const counterId = pa.jsnChain.awaitingCounterFrom;
        engine.respond(counterId, false);
        state = engine.getState();
        continue;
      }

      let handled = false;
      for (const targetId of pa.targetPlayerIds) {
        if (pa.respondedPlayerIds.includes(targetId)) continue;
        const tStrategy = strategyMap.get(targetId)!;
        const tHand = engine.getHand(targetId);
        const tState = engine.getState();
        feedDiscardPile(tStrategy);
        const response = tStrategy.chooseResponse(tState, tHand, targetId, pa);
        engine.respond(targetId, response.accept, response.accept ? response.paymentCardIds : undefined);
        handled = true;
        break;
      }
      if (!handled) {
        // All responded but pendingAction not cleared — force clear
        break;
      }
      state = engine.getState();
      continue;
    }

    const phase = state.turnPhase;

    if (phase === 'draw') {
      const result = engine.draw(currentId);
      if (result.error) engine.endTurn(currentId);
      state = engine.getState();
      continue;
    }

    if (phase === 'discard') {
      if (hand.length > 7) {
        feedDiscardPile(strategy);
        const discardIds = strategy.chooseDiscard(hand);
        const result = engine.discard(currentId, discardIds);
        if (result.error) {
          // Force discard the last cards
          const fallback = hand.slice(7).map(c => c.id);
          engine.discard(currentId, fallback);
        }
      }
      state = engine.getState();
      continue;
    }

    if (phase === 'action') {
      if (state.actionsRemaining <= 0) {
        engine.endTurn(currentId);
        state = engine.getState();
        continue;
      }

      feedDiscardPile(strategy);
      const action = strategy.chooseAction(state, hand, currentId);
      if (!action || action.type === 'end-turn') {
        engine.endTurn(currentId);
        state = engine.getState();
        continue;
      }

      const result = engine.playCard(currentId, action.cardId, action.opts);
      if (result.error) {
        engine.endTurn(currentId);
      }
      state = engine.getState();
      continue;
    }

    // Fallback: if we're stuck in 'waiting' or unknown phase
    break;
  }

  state = engine.getState();
  if (!state.winnerId) return null;

  const playerStats = new Map<string, { completeSets: number; bankValue: number; handSize: number }>();
  for (const p of state.players) {
    playerStats.set(p.id, {
      completeSets: p.propertySets.filter(s => s.isComplete).length,
      bankValue: p.bank.reduce((sum, c) => sum + c.value, 0),
      handSize: p.handCount,
    });
  }

  const winner = state.players.find(p => p.id === state.winnerId)!;
  return {
    winnerId: state.winnerId,
    winnerName: winner.name,
    turns: state.turnNumber,
    playerStats,
  };
}
