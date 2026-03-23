import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import type { GameState, AnyCard, PendingAction } from '@monopoly-deal/shared';
import type { AIStrategy, AIAction, AIResponse } from './types.js';
import { MediumAI } from './MediumAI.js';
import { PolicyNetwork } from '../../../../ai/src/rl/PolicyNetwork.js';
import { RLStrategy } from '../../../../ai/src/rl/RLStrategy.js';
import { PPONetwork } from '../../../../ai/src/rl/PPONetwork.js';
import { PPOStrategy } from '../../../../ai/src/rl/PPOStrategy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BEST_MODEL_PATH = resolve(__dirname, '../../../../ai/data/best-model.json');

function tryLoadBestModel(): AIStrategy | null {
  try {
    if (!existsSync(BEST_MODEL_PATH)) return null;
    const raw = JSON.parse(readFileSync(BEST_MODEL_PATH, 'utf-8'));
    if (!raw.weights) return null;

    if (raw.algorithm === 'ppo') {
      const net = PPONetwork.fromJSON(raw.weights);
      console.log(`[HardAI] Loaded PPO model: ${raw.checkpointId} (Elo: ${raw.elo})`);
      return new PPOStrategy(net);
    }

    const net = PolicyNetwork.fromJSON(raw.weights);
    console.log(`[HardAI] Loaded RL model: ${raw.checkpointId} (Elo: ${raw.elo})`);
    return new RLStrategy(net);
  } catch {
    return null;
  }
}

/**
 * Loads the best trained model if available, otherwise falls back to MediumAI.
 */
export class HardAI implements AIStrategy {
  private delegate: AIStrategy;

  constructor() {
    this.delegate = tryLoadBestModel() ?? new MediumAI();
  }

  chooseAction(state: GameState, hand: AnyCard[], myId: string): AIAction | null {
    return this.delegate.chooseAction(state, hand, myId);
  }

  chooseResponse(state: GameState, hand: AnyCard[], myId: string, pending: PendingAction): AIResponse {
    return this.delegate.chooseResponse(state, hand, myId, pending);
  }

  chooseDiscard(hand: AnyCard[]): string[] {
    return this.delegate.chooseDiscard(hand);
  }
}
