import { GameEngine } from '../../../server/src/game/GameEngine.js';
import type { AIStrategy } from '../../../server/src/game/ai/types.js';
import { PPONetwork } from './PPONetwork.js';
import { PPOStrategy } from './PPOStrategy.js';
import { buildPayableCardPool } from './ActionSpace.js';
import { FEATURE_SIZE } from './FeatureEncoder.js';
import { MAX_ACTIONS } from './ActionSpace.js';

export interface PPOConfig {
  rolloutGames: number;     // games per rollout collection
  ppoEpochs: number;        // K epochs over rollout buffer
  miniBatchSize: number;     // transitions per mini-batch
  gamma: number;             // discount factor
  gaeLambda: number;         // GAE lambda
  clipRatio: number;         // PPO clip epsilon
  valueCoeff: number;        // value loss coefficient
  entropyCoeff: number;      // entropy bonus coefficient
  lr: number;                // learning rate
  // Rewards
  winReward: number;
  loseReward: number;
  setReward: number;
  propertyReward: number;
  rentReward: number;
  actionReward: number;
  unusedActionPenalty: number;
  jsnBlockReward: number;
  dtrComboReward: number;
  overpaymentPenalty: number;
}

export const DEFAULT_PPO_CONFIG: PPOConfig = {
  rolloutGames: 300,
  ppoEpochs: 3,
  miniBatchSize: 256,
  gamma: 0.98,
  gaeLambda: 0.95,
  clipRatio: 0.2,
  valueCoeff: 0.5,
  entropyCoeff: 0.05,
  lr: 1e-4,
  // Sparse rewards: terminal-heavy to let the agent discover its own play style
  winReward: 5.0,
  loseReward: -2.0,
  setReward: 0.3,
  propertyReward: 0,
  rentReward: 0,
  actionReward: 0,
  unusedActionPenalty: 0,
  jsnBlockReward: 0.1,
  dtrComboReward: 0.08,
  overpaymentPenalty: -0.08,
};

interface Transition {
  input: Float32Array;
  validMask: boolean[];
  actionIdx: number;
  logProb: number;
  value: number;
  reward: number;
  done: boolean;
}

export interface RolloutStats {
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgReward: number;
  avgEntropy: number;
  avgTurns: number;
  avgValueLoss: number;
  avgPolicyLoss: number;
  totalTransitions: number;
  winsPerOpponent: Map<string, { wins: number; total: number }>;
  winsPerOpponent2p: Map<string, { wins: number; total: number }>;
}

const MAX_ITERATIONS = 500;
const MAX_TRANSITIONS_PER_GAME = 300;
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

export class PPOTrainer {
  private network: PPONetwork;
  private config: PPOConfig;

  constructor(network: PPONetwork, config: Partial<PPOConfig> = {}) {
    this.network = network;
    this.config = { ...DEFAULT_PPO_CONFIG, ...config };
  }

  setLR(lr: number): void { this.config.lr = lr; }
  setEntropyCoeff(c: number): void { this.config.entropyCoeff = c; }
  getConfig(): PPOConfig { return this.config; }

  /**
   * Collect rollout, compute GAE, run PPO updates.
   */
  trainRollout(opponents: { id: string; strategy: AIStrategy; weight: number }[]): RolloutStats {
    const { rolloutGames, ppoEpochs, miniBatchSize, gamma, gaeLambda, clipRatio, valueCoeff, entropyCoeff, lr } = this.config;

    // Phase 1: Collect transitions from rolloutGames games
    const allTransitions: Transition[] = [];
    let wins = 0;
    let totalReward = 0;
    let totalEntropy = 0;
    let totalSteps = 0;
    let totalTurns = 0;
    let validGames = 0;
    const winsPerOpp = new Map<string, { wins: number; total: number }>();
    const winsPerOpp2p = new Map<string, { wins: number; total: number }>();

    for (let g = 0; g < rolloutGames; g++) {
      const oppEntry = weightedRandomPick(opponents);
      if (!winsPerOpp.has(oppEntry.id)) winsPerOpp.set(oppEntry.id, { wins: 0, total: 0 });
      winsPerOpp.get(oppEntry.id)!.total++;

      const { transitions, won, turns, entropy, numPlayers } = this.playOneGame(oppEntry, g, opponents);

      allTransitions.push(...transitions);
      if (won) { wins++; winsPerOpp.get(oppEntry.id)!.wins++; }
      // Track 2p-only WR for undiluted curriculum promotion
      if (numPlayers === 2) {
        if (!winsPerOpp2p.has(oppEntry.id)) winsPerOpp2p.set(oppEntry.id, { wins: 0, total: 0 });
        winsPerOpp2p.get(oppEntry.id)!.total++;
        if (won) winsPerOpp2p.get(oppEntry.id)!.wins++;
      }
      totalReward += transitions.reduce((s, t) => s + t.reward, 0);
      totalEntropy += entropy * transitions.length;
      totalSteps += transitions.length;
      totalTurns += turns;
      if (turns > 0) validGames++;
    }

    if (allTransitions.length === 0) {
      return {
        gamesPlayed: rolloutGames, wins, winRate: 0, avgReward: 0,
        avgEntropy: 0, avgTurns: 0, avgValueLoss: 0, avgPolicyLoss: 0,
        totalTransitions: 0, winsPerOpponent: winsPerOpp, winsPerOpponent2p: winsPerOpp2p,
      };
    }

    // Phase 2: Compute GAE advantages and returns
    const advantages = new Float64Array(allTransitions.length);
    const returns = new Float64Array(allTransitions.length);
    computeGAE(allTransitions, advantages, returns, gamma, gaeLambda);

    // Normalize advantages
    let advMean = 0;
    for (let i = 0; i < advantages.length; i++) advMean += advantages[i];
    advMean /= advantages.length;
    let advStd = 0;
    for (let i = 0; i < advantages.length; i++) advStd += (advantages[i] - advMean) ** 2;
    advStd = Math.sqrt(advStd / advantages.length + 1e-8);
    for (let i = 0; i < advantages.length; i++) advantages[i] = (advantages[i] - advMean) / advStd;

    // Phase 3: PPO mini-batch updates
    const TARGET_KL = 0.02;
    let totalValueLoss = 0;
    let totalPolicyLoss = 0;
    let updateCount = 0;

    const indices = Array.from({ length: allTransitions.length }, (_, i) => i);

    for (let epoch = 0; epoch < ppoEpochs; epoch++) {
      shuffle(indices);
      let epochKLExceeded = false;

      for (let start = 0; start < indices.length; start += miniBatchSize) {
        const batchIndices = indices.slice(start, start + miniBatchSize);
        if (batchIndices.length === 0) continue;

        let batchPolicyLoss = 0;
        let batchValueLoss = 0;
        let batchKLSum = 0;

        for (const idx of batchIndices) {
          const t = allTransitions[idx];
          const adv = advantages[idx];
          const ret = returns[idx];

          // Forward pass with current weights (training=true for raw softmax)
          const { probs, value } = this.network.forward(t.input, t.validMask, true);
          const newLogProb = Math.log(Math.max(probs[t.actionIdx], 1e-10));

          // Approximate KL: old_logprob - new_logprob
          batchKLSum += t.logProb - newLogProb;

          // PPO clipped objective
          const ratio = Math.exp(newLogProb - t.logProb);
          const surr1 = ratio * adv;
          const surr2 = Math.max(Math.min(ratio, 1 + clipRatio), 1 - clipRatio) * adv;
          const policyLoss = -Math.min(surr1, surr2);

          // Value loss
          const valueLoss = valueCoeff * (value - ret) ** 2;

          // Correct PPO gradient: include ratio term when not clipped
          let policyWeight: number;
          const clipped = ratio < 1 - clipRatio || ratio > 1 + clipRatio;
          if (clipped && surr2 < surr1) {
            policyWeight = 0;
          } else {
            policyWeight = ratio * adv;
          }

          const valueLossGrad = -valueCoeff * 2 * Math.max(-10, Math.min(10, value - ret));

          this.network.accumulatePPOGradient(
            t.actionIdx,
            policyWeight,
            valueLossGrad,
            entropyCoeff,
          );

          batchPolicyLoss += policyLoss;
          batchValueLoss += valueLoss;
        }

        this.network.applyGradients(lr);
        totalPolicyLoss += batchPolicyLoss / batchIndices.length;
        totalValueLoss += batchValueLoss / batchIndices.length;
        updateCount++;

        const approxKL = batchKLSum / batchIndices.length;
        if (approxKL > TARGET_KL) {
          epochKLExceeded = true;
          break;
        }
      }

      if (epochKLExceeded) break;
    }

    return {
      gamesPlayed: rolloutGames,
      wins,
      winRate: validGames > 0 ? wins / validGames : 0,
      avgReward: totalReward / rolloutGames,
      avgEntropy: totalSteps > 0 ? totalEntropy / totalSteps : 0,
      avgTurns: validGames > 0 ? totalTurns / validGames : 0,
      avgValueLoss: updateCount > 0 ? totalValueLoss / updateCount : 0,
      avgPolicyLoss: updateCount > 0 ? totalPolicyLoss / updateCount : 0,
      totalTransitions: allTransitions.length,
      winsPerOpponent: winsPerOpp,
      winsPerOpponent2p: winsPerOpp2p,
    };
  }

  private playOneGame(
    oppEntry: WeightedOpponent,
    gameIndex: number,
    allOpponents?: WeightedOpponent[],
  ): { transitions: Transition[]; won: boolean; turns: number; entropy: number; numPlayers: number } {
    const {
      winReward, loseReward, setReward,
      propertyReward, rentReward, actionReward, unusedActionPenalty,
      jsnBlockReward, dtrComboReward, overpaymentPenalty,
    } = this.config;

    const rlStrategy = new PPOStrategy(this.network, true);

    // 100% 2-player: cleanest learning signal, each action has direct consequence
    const numPlayers = 2;

    // Build opponent list
    const opponentEntries: { id: string; strategy: AIStrategy }[] = [];
    const opponentPool = allOpponents ?? [oppEntry];
    for (let i = 0; i < numPlayers - 1; i++) {
      const picked = weightedRandomPick(opponentPool);
      // Suffix IDs to avoid duplicates
      const suffixedId = numPlayers > 2 ? `${picked.id}_${i}` : picked.id;
      opponentEntries.push({ id: suffixedId, strategy: picked.strategy });
    }

    // Randomize RL agent position
    const rlPosition = Math.floor(Math.random() * numPlayers);
    const players: { id: string; name: string }[] = [];
    const strategyMap = new Map<string, AIStrategy>();

    let oppIdx = 0;
    for (let i = 0; i < numPlayers; i++) {
      if (i === rlPosition) {
        players.push({ id: RL_AGENT_ID, name: 'RL' });
        strategyMap.set(RL_AGENT_ID, rlStrategy);
      } else {
        const opp = opponentEntries[oppIdx++];
        players.push({ id: opp.id, name: opp.id });
        strategyMap.set(opp.id, opp.strategy);
      }
    }

    const engine = new GameEngine(players);
    const transitions: Transition[] = [];
    let prevCompleteSets = 0;
    let prevSetAdvantage = 0; // myCompleteSets - maxOpponentCompleteSets
    let totalEntropy = 0;
    let state = engine.getState();
    let iterations = 0;

    // Helper: feed discard pile to RL strategy before each decision
    const updateDiscardPile = () => {
      rlStrategy.setDiscardPile(engine.getFullDiscardPile());
    };

    // Helper: compute set advantage for opponent-relative reward
    const computeSetAdvantage = (s: typeof state): number => {
      const meP = s.players.find(p => p.id === RL_AGENT_ID);
      if (!meP) return 0;
      const mySets = meP.propertySets.filter(ps => ps.isComplete).length;
      let maxOpp = 0;
      for (const p of s.players) {
        if (p.id === RL_AGENT_ID) continue;
        const oppSets = p.propertySets.filter(ps => ps.isComplete).length;
        if (oppSets > maxOpp) maxOpp = oppSets;
      }
      return mySets - maxOpp;
    };

    while (state.phase !== 'finished' && iterations < MAX_ITERATIONS && transitions.length < MAX_TRANSITIONS_PER_GAME) {
      iterations++;
      state = engine.getState();
      if (state.phase === 'finished') break;

      const currentId = state.players[state.currentPlayerIndex].id;
      const strategy = strategyMap.get(currentId)!;
      const hand = engine.getHand(currentId);

      // ─── Handle pending actions ──────────────────────────────
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

          if (targetId === RL_AGENT_ID) {
            const ppoStrat = tStrategy as PPOStrategy;
            updateDiscardPile();
            const response = ppoStrat.chooseResponse(tState, tHand, targetId, pa);
            const step = ppoStrat.lastStep;

            if (step) {
              let reward = 0;
              if (!response.accept) reward += jsnBlockReward;
              transitions.push({
                input: step.input,
                validMask: step.validMask,
                actionIdx: step.actionIdx,
                logProb: step.logProb,
                value: step.value,
                reward,
                done: false,
              });
              totalEntropy += step.entropy;
            }

            if (!response.accept) {
              engine.respond(targetId, false);
            } else {
              const isMonetary = pa.type === 'rent' || pa.type === 'debt_collector' || pa.type === 'its_my_birthday';
              if (isMonetary && (pa.amount ?? 0) > 0) {
                const me = tState.players.find(p => p.id === targetId)!;
                const amount = pa.amount!;
                const paymentIds: string[] = [];
                const excludeIds = new Set<string>();
                let paidSoFar = 0;
                const pool = buildPayableCardPool(me);

                for (let pIter = 0; pIter < 15 && paidSoFar < amount; pIter++) {
                  const { cardId, finished } = ppoStrat.chooseOnePayment(
                    tState, tHand, targetId, me, amount, paidSoFar, excludeIds,
                  );
                  const payStep = ppoStrat.lastStep;
                  if (payStep) {
                    transitions.push({
                      input: payStep.input,
                      validMask: payStep.validMask,
                      actionIdx: payStep.actionIdx,
                      logProb: payStep.logProb,
                      value: payStep.value,
                      reward: 0,
                      done: false,
                    });
                    totalEntropy += payStep.entropy;
                  }
                  if (finished || !cardId) break;
                  paymentIds.push(cardId);
                  excludeIds.add(cardId);
                  const card = pool.find(c => c.id === cardId);
                  if (card) paidSoFar += card.value;
                }

                const overpay = Math.max(0, paidSoFar - amount);
                if (overpay > 0 && transitions.length > 0) {
                  transitions[transitions.length - 1].reward += overpaymentPenalty * overpay;
                }

                engine.respond(targetId, true, paymentIds);
              } else {
                engine.respond(targetId, true, response.paymentCardIds);
              }
            }
          } else {
            const response = tStrategy.chooseResponse(tState, tHand, targetId, pa);
            engine.respond(targetId, response.accept, response.accept ? response.paymentCardIds : undefined);
          }
          handled = true;
          break;
        }
        if (!handled) break;
        state = engine.getState();
        continue;
      }

      const phase = state.turnPhase;

      // ─── Draw phase ──────────────────────────────────────────
      if (phase === 'draw') {
        const result = engine.draw(currentId);
        if (result.error) engine.endTurn(currentId);
        state = engine.getState();
        continue;
      }

      // ─── Discard phase ───────────────────────────────────────
      if (phase === 'discard') {
        if (hand.length > 7) {
          if (currentId === RL_AGENT_ID) {
            // RL agent picks discards one at a time through the network
            updateDiscardPile();
            const ppoStrat = strategy as PPOStrategy;
            const discardIds: string[] = [];
            let currentHand = engine.getHand(currentId);
            while (currentHand.length > 7) {
              const dState = engine.getState();
              const cardId = ppoStrat.chooseOneDiscard(dState, currentHand, currentId);
              const step = ppoStrat.lastStep;
              if (step) {
                transitions.push({
                  input: step.input,
                  validMask: step.validMask,
                  actionIdx: step.actionIdx,
                  logProb: step.logProb,
                  value: step.value,
                  reward: 0,
                  done: false,
                });
                totalEntropy += step.entropy;
              }
              discardIds.push(cardId);
              const result = engine.discard(currentId, [cardId]);
              if (result.error) break;
              currentHand = engine.getHand(currentId);
            }
          } else {
            const discardIds = strategy.chooseDiscard(hand);
            const result = engine.discard(currentId, discardIds);
            if (result.error) engine.discard(currentId, hand.slice(7).map(c => c.id));
          }
        }
        state = engine.getState();
        continue;
      }

      // ─── Action phase ────────────────────────────────────────
      if (phase === 'action') {
        if (state.actionsRemaining <= 0) {
          engine.endTurn(currentId);
          state = engine.getState();
          continue;
        }

        // RL agent gets one rearrange decision before choosing an action (free, no action cost)
        if (currentId === RL_AGENT_ID) {
          updateDiscardPile();
          const ppoStrat = strategy as PPOStrategy;
          const rState = engine.getState();
          const rHand = engine.getHand(currentId);
          const rResult = ppoStrat.chooseOneRearrange(rState, rHand, currentId);
          const rStep = ppoStrat.lastStep;

          if (rStep && rResult) {
            const meBefore = rState.players.find(p => p.id === RL_AGENT_ID)!;
            const setsBefore = meBefore.propertySets.filter(s => s.isComplete).length;

            engine.rearrange(currentId, rResult.cardId, rResult.toColor);
            const afterState = engine.getState();
            const meAfter = afterState.players.find(p => p.id === RL_AGENT_ID)!;
            const setsAfter = meAfter.propertySets.filter(s => s.isComplete).length;
            const setDelta = setsAfter - setsBefore;
            if (setDelta > 0) prevCompleteSets = setsAfter;

            transitions.push({
              input: rStep.input, validMask: rStep.validMask,
              actionIdx: rStep.actionIdx, logProb: rStep.logProb,
              value: rStep.value, reward: setDelta * setReward, done: false,
            });
            totalEntropy += rStep.entropy;
          }
        }

        state = engine.getState();
        if (state.phase === 'finished') break;
        if (state.actionsRemaining <= 0) {
          engine.endTurn(currentId);
          state = engine.getState();
          continue;
        }

        const actionsBeforeChoice = state.actionsRemaining;
        if (currentId === RL_AGENT_ID) updateDiscardPile();
        const action = strategy.chooseAction(state, engine.getHand(currentId), currentId);

        if (currentId === RL_AGENT_ID) {
          const ppoStrat = strategy as PPOStrategy;
          const step = ppoStrat.lastStep;

          if (step) {
            const me = state.players.find(p => p.id === RL_AGENT_ID)!;
            const currentSets = me.propertySets.filter(s => s.isComplete).length;
            const setDelta = currentSets - prevCompleteSets;
            prevCompleteSets = currentSets;

            let reward = setDelta * setReward;

            if (action && action.type === 'play-card') {
              const currentHand = engine.getHand(currentId);
              const card = currentHand.find(c => c.id === action.cardId);
              if (card) {
                if (card.type === 'property' || card.type === 'property_wildcard') {
                  reward += propertyReward;
                } else if (card.type === 'rent') {
                  reward += rentReward;
                  if (action.opts?.doubleTheRentCardIds?.length) reward += dtrComboReward;
                } else if (card.type === 'action' && !action.opts?.asMoney) {
                  reward += actionReward;
                }
              }
            }

            if ((!action || action.type === 'end-turn') && actionsBeforeChoice > 1) {
              reward += unusedActionPenalty * (actionsBeforeChoice - 1);
            }

            transitions.push({
              input: step.input,
              validMask: step.validMask,
              actionIdx: step.actionIdx,
              logProb: step.logProb,
              value: step.value,
              reward,
              done: false,
            });
            totalEntropy += step.entropy;
          }
        }

        if (!action || action.type === 'end-turn') {
          engine.endTurn(currentId);
          state = engine.getState();
          continue;
        }

        const preSets = currentId === RL_AGENT_ID
          ? state.players.find(p => p.id === RL_AGENT_ID)!.propertySets.filter(s => s.isComplete).length
          : 0;
        const result = engine.playCard(currentId, action.cardId, action.opts);
        if (result.error) engine.endTurn(currentId);
        state = engine.getState();

        // Post-action set completion bonus + opponent-relative advantage for RL agent
        if (currentId === RL_AGENT_ID && transitions.length > 0) {
          const postSets = state.players.find(p => p.id === RL_AGENT_ID)?.propertySets.filter(s => s.isComplete).length ?? 0;
          const newSets = postSets - preSets;
          if (newSets > 0) {
            transitions[transitions.length - 1].reward += newSets * setReward;
            prevCompleteSets = postSets;
          }
          // Opponent-relative set advantage reward (small to avoid noisy value targets)
          const newAdv = computeSetAdvantage(state);
          if (newAdv > prevSetAdvantage) {
            transitions[transitions.length - 1].reward += 0.05;
          } else if (newAdv < prevSetAdvantage) {
            transitions[transitions.length - 1].reward -= 0.03;
          }
          prevSetAdvantage = newAdv;
        }
        continue;
      }

      break;
    }

    state = engine.getState();
    const won = state.winnerId === RL_AGENT_ID;
    // Don't dilute lose penalty by numPlayers — the agent lost regardless of how many opponents
    let terminal = won ? winReward : (state.winnerId ? loseReward : 0);

    // Win margin bonus: reward dominant wins
    if (won) {
      const myFinalSets = state.players.find(p => p.id === RL_AGENT_ID)?.propertySets.filter(s => s.isComplete).length ?? 3;
      let bestOppSets = 0;
      for (const p of state.players) {
        if (p.id === RL_AGENT_ID) continue;
        const oppSets = p.propertySets.filter(s => s.isComplete).length;
        if (oppSets > bestOppSets) bestOppSets = oppSets;
      }
      terminal += 0.1 * Math.max(0, myFinalSets - bestOppSets);
    }

    if (transitions.length > 0) {
      transitions[transitions.length - 1].reward += terminal;
      transitions[transitions.length - 1].done = true;
    }

    return {
      transitions,
      won,
      turns: state.turnNumber,
      entropy: transitions.length > 0 ? totalEntropy / transitions.length : 0,
      numPlayers,
    };
  }

  getNetwork(): PPONetwork {
    return this.network;
  }

  /**
   * Phase 1 only: collect transitions from games (no GAE/PPO updates).
   * Used by workers for parallel game collection.
   */
  collectGames(opponents: WeightedOpponent[], numGames: number): CollectedData {
    const allTransitions: Transition[] = [];
    const gameResults: GameResult[] = [];
    let totalEntropy = 0;
    let totalSteps = 0;

    for (let g = 0; g < numGames; g++) {
      const oppEntry = weightedRandomPick(opponents);
      const { transitions, won, turns, entropy, numPlayers } = this.playOneGame(oppEntry, g, opponents);

      allTransitions.push(...transitions);
      totalEntropy += entropy * transitions.length;
      totalSteps += transitions.length;
      gameResults.push({ won, turns, entropy, numPlayers, opponentId: oppEntry.id });
    }

    // Pack transitions into flat typed arrays for efficient transfer
    const count = allTransitions.length;
    const inputs = new Float32Array(count * FEATURE_SIZE);
    const masks = new Uint8Array(count * MAX_ACTIONS);
    const actions = new Int32Array(count);
    const logProbs = new Float32Array(count);
    const values = new Float32Array(count);
    const rewards = new Float32Array(count);
    const dones = new Uint8Array(count);

    for (let i = 0; i < count; i++) {
      const t = allTransitions[i];
      inputs.set(t.input, i * FEATURE_SIZE);
      for (let j = 0; j < MAX_ACTIONS; j++) masks[i * MAX_ACTIONS + j] = t.validMask[j] ? 1 : 0;
      actions[i] = t.actionIdx;
      logProbs[i] = t.logProb;
      values[i] = t.value;
      rewards[i] = t.reward;
      dones[i] = t.done ? 1 : 0;
    }

    return {
      packed: { count, inputs, masks, actions, logProbs, values, rewards, dones },
      gameResults,
    };
  }

  /**
   * Phases 2-3: Run GAE + PPO updates on pre-collected transitions.
   * Used by main thread after workers return collected data.
   */
  trainOnCollectedData(data: CollectedData): RolloutStats {
    const { ppoEpochs, miniBatchSize, gamma, gaeLambda, clipRatio, valueCoeff, entropyCoeff, lr } = this.config;
    const { packed, gameResults } = data;
    const { count, inputs, masks, actions, logProbs, values, rewards, dones } = packed;

    // Unpack transitions
    const allTransitions: Transition[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const validMask: boolean[] = new Array(MAX_ACTIONS);
      for (let j = 0; j < MAX_ACTIONS; j++) validMask[j] = masks[i * MAX_ACTIONS + j] === 1;
      allTransitions[i] = {
        input: inputs.subarray(i * FEATURE_SIZE, (i + 1) * FEATURE_SIZE),
        validMask,
        actionIdx: actions[i],
        logProb: logProbs[i],
        value: values[i],
        reward: rewards[i],
        done: dones[i] === 1,
      };
    }

    // Compute stats from game results
    const winsPerOpp = new Map<string, { wins: number; total: number }>();
    const winsPerOpp2p = new Map<string, { wins: number; total: number }>();
    let wins = 0;
    let totalTurns = 0;
    let validGames = 0;
    let totalEntropy = 0;
    let totalReward = 0;

    for (const gr of gameResults) {
      if (!winsPerOpp.has(gr.opponentId)) winsPerOpp.set(gr.opponentId, { wins: 0, total: 0 });
      winsPerOpp.get(gr.opponentId)!.total++;
      if (gr.won) { wins++; winsPerOpp.get(gr.opponentId)!.wins++; }
      if (gr.numPlayers === 2) {
        if (!winsPerOpp2p.has(gr.opponentId)) winsPerOpp2p.set(gr.opponentId, { wins: 0, total: 0 });
        winsPerOpp2p.get(gr.opponentId)!.total++;
        if (gr.won) winsPerOpp2p.get(gr.opponentId)!.wins++;
      }
      totalTurns += gr.turns;
      if (gr.turns > 0) validGames++;
      totalEntropy += gr.entropy;
    }

    for (let i = 0; i < count; i++) totalReward += rewards[i];

    if (count === 0) {
      return {
        gamesPlayed: gameResults.length, wins, winRate: 0, avgReward: 0,
        avgEntropy: 0, avgTurns: 0, avgValueLoss: 0, avgPolicyLoss: 0,
        totalTransitions: 0, winsPerOpponent: winsPerOpp, winsPerOpponent2p: winsPerOpp2p,
      };
    }

    // Phase 2: GAE
    const advantages = new Float64Array(count);
    const returns = new Float64Array(count);
    computeGAE(allTransitions, advantages, returns, gamma, gaeLambda);

    let advMean = 0;
    for (let i = 0; i < count; i++) advMean += advantages[i];
    advMean /= count;
    let advStd = 0;
    for (let i = 0; i < count; i++) advStd += (advantages[i] - advMean) ** 2;
    advStd = Math.sqrt(advStd / count + 1e-8);
    for (let i = 0; i < count; i++) advantages[i] = (advantages[i] - advMean) / advStd;

    // Phase 3: PPO updates
    const TARGET_KL = 0.02;
    let totalValueLoss = 0;
    let totalPolicyLoss = 0;
    let updateCount = 0;
    const indices = Array.from({ length: count }, (_, i) => i);

    for (let epoch = 0; epoch < ppoEpochs; epoch++) {
      shuffle(indices);
      let epochKLExceeded = false;

      for (let start = 0; start < indices.length; start += miniBatchSize) {
        const batchIndices = indices.slice(start, start + miniBatchSize);
        if (batchIndices.length === 0) continue;

        let batchPolicyLoss = 0;
        let batchValueLoss = 0;
        let batchKLSum = 0;

        for (const idx of batchIndices) {
          const t = allTransitions[idx];
          const adv = advantages[idx];
          const ret = returns[idx];

          const { probs, value } = this.network.forward(t.input, t.validMask, true);
          const newLogProb = Math.log(Math.max(probs[t.actionIdx], 1e-10));
          batchKLSum += t.logProb - newLogProb;

          const ratio = Math.exp(newLogProb - t.logProb);
          const surr1 = ratio * adv;
          const surr2 = Math.max(Math.min(ratio, 1 + clipRatio), 1 - clipRatio) * adv;
          const policyLoss = -Math.min(surr1, surr2);
          const valueLoss = valueCoeff * (value - ret) ** 2;

          // Correct PPO gradient: include ratio term when not clipped
          let policyWeight: number;
          const clipped = ratio < 1 - clipRatio || ratio > 1 + clipRatio;
          if (clipped && surr2 < surr1) policyWeight = 0;
          else policyWeight = ratio * adv;

          const valueLossGrad = -valueCoeff * 2 * Math.max(-10, Math.min(10, value - ret));
          this.network.accumulatePPOGradient(t.actionIdx, policyWeight, valueLossGrad, entropyCoeff);

          batchPolicyLoss += policyLoss;
          batchValueLoss += valueLoss;
        }

        this.network.applyGradients(lr);
        totalPolicyLoss += batchPolicyLoss / batchIndices.length;
        totalValueLoss += batchValueLoss / batchIndices.length;
        updateCount++;

        if (batchKLSum / batchIndices.length > TARGET_KL) { epochKLExceeded = true; break; }
      }
      if (epochKLExceeded) break;
    }

    return {
      gamesPlayed: gameResults.length, wins,
      winRate: validGames > 0 ? wins / validGames : 0,
      avgReward: totalReward / gameResults.length,
      avgEntropy: gameResults.length > 0 ? totalEntropy / gameResults.length : 0,
      avgTurns: validGames > 0 ? totalTurns / validGames : 0,
      avgValueLoss: updateCount > 0 ? totalValueLoss / updateCount : 0,
      avgPolicyLoss: updateCount > 0 ? totalPolicyLoss / updateCount : 0,
      totalTransitions: count,
      winsPerOpponent: winsPerOpp,
      winsPerOpponent2p: winsPerOpp2p,
    };
  }
}

// ─── Packed data types for worker communication ──────────────────────────

export interface PackedTransitions {
  count: number;
  inputs: Float32Array;
  masks: Uint8Array;
  actions: Int32Array;
  logProbs: Float32Array;
  values: Float32Array;
  rewards: Float32Array;
  dones: Uint8Array;
}

export interface GameResult {
  won: boolean;
  turns: number;
  entropy: number;
  numPlayers: number;
  opponentId: string;
}

export interface CollectedData {
  packed: PackedTransitions;
  gameResults: GameResult[];
}

// ─── GAE computation ──────────────────────────────────────────────────────

function computeGAE(
  transitions: Transition[],
  advantages: Float64Array,
  returns: Float64Array,
  gamma: number,
  lambda: number,
): void {
  let lastGAE = 0;
  let lastValue = 0;

  for (let t = transitions.length - 1; t >= 0; t--) {
    const tr = transitions[t];

    if (tr.done) {
      lastGAE = 0;
      lastValue = 0;
    }

    const delta = tr.reward + gamma * lastValue - tr.value;
    lastGAE = delta + gamma * lambda * lastGAE;
    advantages[t] = lastGAE;
    returns[t] = lastGAE + tr.value;

    lastValue = tr.value;
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────

function shuffle(arr: number[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
