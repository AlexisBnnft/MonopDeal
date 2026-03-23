import { GameEngine } from '../../../server/src/game/GameEngine.js';
import type { AIStrategy } from '../../../server/src/game/ai/types.js';
import { PolicyNetwork } from './PolicyNetwork.js';
import { RLStrategy } from './RLStrategy.js';

export interface TrainConfig {
  batchSize: number;
  lr: number;
  gamma: number;
  entropyBonus: number;
  winReward: number;
  loseReward: number;
  setReward: number;
  propertyReward: number;
  rentReward: number;
  actionReward: number;
  unusedActionPenalty: number;
}

export const DEFAULT_CONFIG: TrainConfig = {
  batchSize: 100,
  lr: 0.001,
  gamma: 0.99,
  entropyBonus: 0.01,
  winReward: 1.0,
  loseReward: -1.0,
  setReward: 0.15,
  propertyReward: 0.02,
  rentReward: 0.05,
  actionReward: 0.03,
  unusedActionPenalty: -0.01,
};

interface StepData {
  actionIdx: number;
  reward: number;
  input: Float64Array;
  validMask: boolean[];
  entropy: number;
}

export interface BatchStats {
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgReward: number;
  avgEntropy: number;
  avgTurns: number;
  winsPerOpponent: Map<string, { wins: number; total: number }>;
}

const MAX_ITERATIONS = 3000;
const RL_AGENT_ID = 'rl_agent';

interface WeightedOpponent {
  id: string;
  strategy: AIStrategy;
  weight: number;
}

function weightedRandomPick(opponents: WeightedOpponent[]): WeightedOpponent {
  const totalWeight = opponents.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * totalWeight;
  for (const opp of opponents) {
    r -= opp.weight;
    if (r <= 0) return opp;
  }
  return opponents[opponents.length - 1];
}

export class Trainer {
  private network: PolicyNetwork;
  private config: TrainConfig;

  constructor(network: PolicyNetwork, config: Partial<TrainConfig> = {}) {
    this.network = network;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setLR(lr: number): void {
    this.config.lr = lr;
  }

  /**
   * Play batchSize games, collect trajectories, then do a single gradient
   * update using per-batch baseline and replayed forward passes.
   */
  trainBatch(opponents: { id: string; strategy: AIStrategy }[]): BatchStats {
    const {
      batchSize, gamma, winReward, loseReward, setReward, lr, entropyBonus,
      propertyReward, rentReward, actionReward, unusedActionPenalty,
    } = this.config;
    const weightedOpps = applyOpponentWeights(opponents);

    let totalReward = 0;
    let totalEntropy = 0;
    let totalSteps = 0;
    let wins = 0;
    let totalTurns = 0;
    let validGames = 0;
    const winsPerOpp = new Map<string, { wins: number; total: number }>();

    interface GameTrajectory {
      steps: StepData[];
      returns: Float64Array;
    }
    const trajectories: GameTrajectory[] = [];

    // ─── Phase 1: play all games and collect trajectories ──────────
    for (let g = 0; g < batchSize; g++) {
      const oppEntry = weightedRandomPick(weightedOpps);
      if (!winsPerOpp.has(oppEntry.id)) winsPerOpp.set(oppEntry.id, { wins: 0, total: 0 });
      winsPerOpp.get(oppEntry.id)!.total++;

      const rlStrategy = new RLStrategy(this.network, true);

      const rlFirst = g % 2 === 0;
      const players = rlFirst
        ? [{ id: RL_AGENT_ID, name: 'RL' }, { id: oppEntry.id, name: oppEntry.id }]
        : [{ id: oppEntry.id, name: oppEntry.id }, { id: RL_AGENT_ID, name: 'RL' }];

      const strategyMap = new Map<string, AIStrategy>([
        [RL_AGENT_ID, rlStrategy],
        [oppEntry.id, oppEntry.strategy],
      ]);

      const engine = new GameEngine(players);
      const steps: StepData[] = [];
      let prevCompleteSets = 0;
      let prevPropertyCount = 0;
      let prevBankValue = 0;
      let state = engine.getState();
      let iterations = 0;

      // Initialize baseline board stats
      const meInit = state.players.find(p => p.id === RL_AGENT_ID)!;
      prevPropertyCount = countProperties(meInit);
      prevBankValue = meInit.bank.reduce((s, c) => s + c.value, 0);

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
            engine.respond(pa.jsnChain.awaitingCounterFrom, false);
            state = engine.getState();
            continue;
          }
          let handled = false;
          for (const targetId of pa.targetPlayerIds) {
            if (pa.respondedPlayerIds.includes(targetId)) continue;
            const tStrategy = strategyMap.get(targetId)!;
            const tHand = engine.getHand(targetId);
            const tState = engine.getState();
            const response = tStrategy.chooseResponse(tState, tHand, targetId, pa);
            engine.respond(targetId, response.accept, response.accept ? response.paymentCardIds : undefined);
            handled = true;
            break;
          }
          if (!handled) break;
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
            const discardIds = strategy.chooseDiscard(hand);
            const result = engine.discard(currentId, discardIds);
            if (result.error) engine.discard(currentId, hand.slice(7).map(c => c.id));
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

          const actionsBeforeChoice = state.actionsRemaining;
          const action = strategy.chooseAction(state, hand, currentId);

          if (currentId === RL_AGENT_ID && rlStrategy.lastStep) {
            const step = rlStrategy.lastStep;
            const me = state.players.find(p => p.id === RL_AGENT_ID)!;

            // Set completion reward
            const currentSets = me.propertySets.filter(s => s.isComplete).length;
            const setDelta = currentSets - prevCompleteSets;
            prevCompleteSets = currentSets;

            let reward = setDelta * setReward;

            // Determine action type for intermediate rewards
            if (action && action.type === 'play-card') {
              const card = hand.find(c => c.id === action.cardId);
              if (card) {
                if (card.type === 'property' || card.type === 'property_wildcard') {
                  reward += propertyReward;
                } else if (card.type === 'rent') {
                  reward += rentReward;
                } else if (card.type === 'action' && !action.opts?.asMoney) {
                  reward += actionReward;
                }
              }
            }

            // Penalty for choosing end-turn with actions remaining
            if ((!action || action.type === 'end-turn') && actionsBeforeChoice > 1) {
              reward += unusedActionPenalty * (actionsBeforeChoice - 1);
            }

            const { input, validMask } = rlStrategy.getLastForwardData();
            steps.push({
              actionIdx: step.actionIdx,
              reward,
              input,
              validMask,
              entropy: step.entropy,
            });

            totalEntropy += step.entropy;
            totalSteps++;
          }

          if (!action || action.type === 'end-turn') {
            engine.endTurn(currentId);
            state = engine.getState();
            continue;
          }

          const result = engine.playCard(currentId, action.cardId, action.opts);
          if (result.error) engine.endTurn(currentId);
          state = engine.getState();
          continue;
        }

        break;
      }

      state = engine.getState();
      const won = state.winnerId === RL_AGENT_ID;
      const terminal = won ? winReward : (state.winnerId ? loseReward : 0);

      if (steps.length > 0) {
        steps[steps.length - 1].reward += terminal;
      }

      totalReward += terminal;
      if (won) {
        wins++;
        winsPerOpp.get(oppEntry.id)!.wins++;
      }
      totalTurns += state.turnNumber;
      if (state.winnerId) validGames++;

      // Compute discounted returns for this episode
      if (steps.length > 0) {
        const returns = new Float64Array(steps.length);
        let G = 0;
        for (let t = steps.length - 1; t >= 0; t--) {
          G = steps[t].reward + gamma * G;
          returns[t] = G;
        }
        trajectories.push({ steps, returns });
      }
    }

    // ─── Phase 2: compute per-batch baseline ───────────────────────
    let batchBaseline = 0;
    if (trajectories.length > 0) {
      let sum = 0;
      for (const traj of trajectories) sum += traj.returns[0];
      batchBaseline = sum / trajectories.length;
    }

    // ─── Phase 3: replay forward passes and accumulate gradients ───
    for (const traj of trajectories) {
      for (let t = 0; t < traj.steps.length; t++) {
        const step = traj.steps[t];
        this.network.forward(step.input, step.validMask);
        const advantage = traj.returns[t] - batchBaseline;
        this.network.accumulateGradient(step.actionIdx, advantage, entropyBonus);
      }
    }

    this.network.applyGradients(lr);

    return {
      gamesPlayed: batchSize,
      wins,
      winRate: validGames > 0 ? wins / validGames : 0,
      avgReward: totalReward / batchSize,
      avgEntropy: totalSteps > 0 ? totalEntropy / totalSteps : 0,
      avgTurns: validGames > 0 ? totalTurns / validGames : 0,
      winsPerOpponent: winsPerOpp,
    };
  }

  getNetwork(): PolicyNetwork {
    return this.network;
  }
}

function applyOpponentWeights(opponents: { id: string; strategy: AIStrategy }[]): WeightedOpponent[] {
  const WEIGHTS: Record<string, number> = {
    MediumAI: 50,
    EasyAI: 35,
    RandomBot: 15,
  };
  return opponents.map(o => ({
    ...o,
    weight: WEIGHTS[o.id] ?? 20,
  }));
}

function countProperties(player: { propertySets: { cards: { type: string }[] }[] }): number {
  let count = 0;
  for (const set of player.propertySets) {
    for (const c of set.cards) {
      if (c.type === 'property' || c.type === 'property_wildcard') count++;
    }
  }
  return count;
}
