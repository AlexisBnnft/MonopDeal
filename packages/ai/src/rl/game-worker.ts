/**
 * Worker thread for parallel game collection.
 * Plays games independently using a frozen copy of the network,
 * then sends packed transitions back to the main thread.
 */
import { parentPort } from 'node:worker_threads';
import { PPONetwork, type PPONetworkWeights } from './PPONetwork.js';
import { PPOStrategy } from './PPOStrategy.js';
import { PPOTrainer, type PPOConfig } from './PPOTrainer.js';
import { RandomAI } from '../../../server/src/game/ai/RandomAI.js';
import { EasyAI } from '../../../server/src/game/ai/EasyAI.js';
import { MediumAI } from '../../../server/src/game/ai/MediumAI.js';
import { AggressiveAI } from '../../../server/src/game/ai/AggressiveAI.js';
import { HoarderAI } from '../../../server/src/game/ai/HoarderAI.js';
import type { AIStrategy } from '../../../server/src/game/ai/types.js';

export interface OpponentSpec {
  id: string;
  type: 'random' | 'easy' | 'medium' | 'aggressive' | 'hoarder' | 'ppo';
  weights?: PPONetworkWeights;
  weight: number;
}

export interface PlayBatchMsg {
  type: 'play-batch';
  networkWeights: PPONetworkWeights;
  opponents: OpponentSpec[];
  gamesToPlay: number;
  rewardConfig: Partial<PPOConfig>;
}

function createStrategy(spec: OpponentSpec): AIStrategy {
  switch (spec.type) {
    case 'random': return new RandomAI();
    case 'easy': return new EasyAI();
    case 'medium': return new MediumAI();
    case 'aggressive': return new AggressiveAI();
    case 'hoarder': return new HoarderAI();
    case 'ppo': return new PPOStrategy(PPONetwork.fromJSON(spec.weights!));
  }
}

parentPort!.on('message', (msg: PlayBatchMsg) => {
  if (msg.type !== 'play-batch') return;

  const network = PPONetwork.fromJSON(msg.networkWeights);
  const trainer = new PPOTrainer(network, msg.rewardConfig);

  const opponents = msg.opponents.map(spec => ({
    id: spec.id,
    strategy: createStrategy(spec),
    weight: spec.weight,
  }));

  const data = trainer.collectGames(opponents, msg.gamesToPlay);

  // Transfer typed arrays for zero-copy (buffers move, not copied)
  const { packed } = data;
  parentPort!.postMessage(
    { type: 'results', packed, gameResults: data.gameResults },
    [
      packed.inputs.buffer,
      packed.masks.buffer,
      packed.actions.buffer,
      packed.logProbs.buffer,
      packed.values.buffer,
      packed.rewards.buffer,
      packed.dones.buffer,
    ],
  );
});
