import { writeFileSync, appendFileSync, mkdirSync, existsSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { PPONetwork, type PPONetworkWeights, type PPOFullState } from './rl/PPONetwork.js';
import { PPOStrategy } from './rl/PPOStrategy.js';
import { PPOTrainer, DEFAULT_PPO_CONFIG, type CollectedData, type PackedTransitions, type GameResult } from './rl/PPOTrainer.js';
import { FEATURE_SIZE } from './rl/FeatureEncoder.js';
import { MAX_ACTIONS } from './rl/ActionSpace.js';
import { EloArena } from './EloArena.js';
import { EloTracker, type EloSnapshot } from './EloTracker.js';
import { generateDashboard } from './generate-graphs.js';
import { RandomAI } from '../../server/src/game/ai/RandomAI.js';
import { EasyAI } from '../../server/src/game/ai/EasyAI.js';
import { MediumAI } from '../../server/src/game/ai/MediumAI.js';
import { AggressiveAI } from '../../server/src/game/ai/AggressiveAI.js';
import { HoarderAI } from '../../server/src/game/ai/HoarderAI.js';
import type { OpponentSpec, PlayBatchMsg } from './rl/game-worker.js';

// ─── CLI args ────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  let games = 500_000;
  let evalEvery = 2_000;
  let rolloutGames = 300;
  let lr = 1e-4;
  let keepOldData = false;
  let resume = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--games' && args[i + 1]) games = parseInt(args[++i], 10);
    else if (args[i] === '--eval-every' && args[i + 1]) evalEvery = parseInt(args[++i], 10);
    else if (args[i] === '--rollout' && args[i + 1]) rolloutGames = parseInt(args[++i], 10);
    else if (args[i] === '--lr' && args[i + 1]) lr = parseFloat(args[++i]);
    else if (args[i] === '--keep-old-data') keepOldData = true;
    else if (args[i] === '--resume') resume = true;
  }
  return { games, evalEvery, rolloutGames, lr, keepOldData, resume };
}

const { games: TOTAL_GAMES, evalEvery: EVAL_EVERY, rolloutGames: ROLLOUT_GAMES, lr: LR, keepOldData, resume: RESUME } = parseArgs();

const DATA_DIR = new URL('../data', import.meta.url);
const CHECKPOINTS_DIR = new URL('../data/checkpoints', import.meta.url);
const BEST_MODEL_PATH = new URL('../data/best-model.json', import.meta.url);
const LOG_PATH = new URL('../data/training-log.jsonl', import.meta.url);
const PROGRESSION_PATH = new URL('../data/elo-progression.json', import.meta.url);
const TRAINING_STATE_PATH = new URL('../data/training-state.json', import.meta.url);

interface TrainingState {
  gamesPlayed: number;
  rolloutNum: number;
  lastEvalAt: number;
  bestElo: number;
  bestCheckpoint: string;
  networkFullState: PPOFullState;
  selfPlayCheckpointIds: string[];
  curriculumStage: number;
  selfPlayActive: boolean;
  selfPlayCheckpointElos: { id: string; elo: number }[];
}

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(CHECKPOINTS_DIR, { recursive: true });

// ─── Init ────────────────────────────────────────────────────────────────
const INITIAL_ENTROPY_COEFF = 0.05;  // Encourage exploration early
const FINAL_ENTROPY_COEFF = 0.035;  // Higher floor prevents self-play drift

// ─── Curriculum config ────────────────────────────────────────────────
// Smoother transitions with intermediate stages and higher promotion thresholds
const CURRICULUM = [
  { opponents: { RandomBot: 80, EasyAI: 20, MediumAI: 0, AggressiveAI: 0, HoarderAI: 0 }, promoteOn: 'RandomBot' as string | null, promoteWR: 0.75 },
  { opponents: { RandomBot: 30, EasyAI: 50, MediumAI: 10, AggressiveAI: 5, HoarderAI: 5 }, promoteOn: 'EasyAI' as string | null, promoteWR: 0.55 },
  { opponents: { RandomBot: 10, EasyAI: 20, MediumAI: 40, AggressiveAI: 15, HoarderAI: 15 }, promoteOn: 'MediumAI' as string | null, promoteWR: 0.30 },
  { opponents: { RandomBot: 5, EasyAI: 10, MediumAI: 50, AggressiveAI: 17, HoarderAI: 18 }, promoteOn: 'MediumAI' as string | null, promoteWR: 0.38 },
  { opponents: { RandomBot: 0, EasyAI: 5, MediumAI: 45, AggressiveAI: 35, HoarderAI: 15 }, promoteOn: null, promoteWR: 1 },
];

// Rolling WR tracker for curriculum promotion (2p-only to avoid multi-player dilution)
const ROLLING_WINDOW = 15;  // Longer window for more stable promotion decisions
const rollingWRBuffer2p: Map<string, { wins: number; total: number }>[] = [];

function computeRollingWR2p(opponentId: string): number {
  let totalWins = 0, totalGames = 0;
  for (const entry of rollingWRBuffer2p) {
    const stats = entry.get(opponentId);
    if (stats) { totalWins += stats.wins; totalGames += stats.total; }
  }
  return totalGames > 0 ? totalWins / totalGames : 0;
}

// ─── Self-play league config ─────────────────────────────────────────
// Activate self-play once the agent is competitive with heuristic bots
const SELF_PLAY_ELO_THRESHOLD = 1350;
const MAX_LEAGUE_SIZE = 5;   // Small league of only strong checkpoints
const SELF_PLAY_WEIGHT = 15;  // Keep 85% of games against heuristic bots

let gamesPlayed = 0;
let lastEvalAt = 0;
let bestElo = -Infinity;
let bestCheckpoint = '';
let rolloutNum = 0;
let network: PPONetwork;
let currentStage = 0;
let selfPlayActive = false;
const selfPlayCheckpoints: { id: string; strategy: PPOStrategy; elo: number; weights: PPONetworkWeights }[] = [];

if (RESUME && existsSync(TRAINING_STATE_PATH)) {
  const saved: TrainingState = JSON.parse(readFileSync(TRAINING_STATE_PATH, 'utf-8'));
  gamesPlayed = saved.gamesPlayed;
  rolloutNum = saved.rolloutNum;
  lastEvalAt = saved.lastEvalAt;
  bestElo = saved.bestElo;
  bestCheckpoint = saved.bestCheckpoint;
  network = PPONetwork.fromFullJSON(saved.networkFullState);

  currentStage = saved.curriculumStage ?? 0;
  selfPlayActive = saved.selfPlayActive ?? false;
  const savedElos = saved.selfPlayCheckpointElos ?? [];

  for (const cpId of saved.selfPlayCheckpointIds) {
    const cpPath = new URL(`../data/checkpoints/${cpId}.json`, import.meta.url);
    if (existsSync(cpPath)) {
      const cpWeights: PPONetworkWeights = JSON.parse(readFileSync(cpPath, 'utf-8'));
      const cpElo = savedElos.find(e => e.id === cpId)?.elo ?? 1000;
      selfPlayCheckpoints.push({ id: cpId, strategy: new PPOStrategy(PPONetwork.fromJSON(cpWeights)), elo: cpElo, weights: cpWeights });
    }
  }

  // Re-check self-play threshold on resume — disable if Elo dropped below threshold
  if (selfPlayActive && bestElo < SELF_PLAY_ELO_THRESHOLD) {
    selfPlayActive = false;
    selfPlayCheckpoints.length = 0;
    console.log(`[Resume] Disabled self-play: best Elo ${bestElo} < threshold ${SELF_PLAY_ELO_THRESHOLD}`);
  }

  console.log(`[Resume] Loaded training state: ${gamesPlayed} games, rollout ${rolloutNum}, best Elo ${bestElo} (${bestCheckpoint}), stage ${currentStage + 1}/${CURRICULUM.length}, selfPlay=${selfPlayActive}`);
} else {
  if (!keepOldData && !RESUME) {
    writeFileSync(PROGRESSION_PATH, '[]');
    try {
      for (const f of readdirSync(CHECKPOINTS_DIR)) {
        if (f.endsWith('.json')) unlinkSync(new URL(`../data/checkpoints/${f}`, import.meta.url));
      }
    } catch { /* dir may not exist yet */ }
    console.log('[Reset] Cleared old elo-progression.json and checkpoints/');
  }
  network = new PPONetwork();
  writeFileSync(LOG_PATH, '');
}

const NUM_WORKERS = Math.max(1, cpus().length - 1);

console.log('\n╔════════════════════════════════════════════════════╗');
console.log('║       MonopDeal PPO Training Pipeline              ║');
console.log('╠════════════════════════════════════════════════════╣');
console.log(`║  Total games:    ${String(TOTAL_GAMES).padStart(8)}                       ║`);
console.log(`║  Rollout size:   ${String(ROLLOUT_GAMES).padStart(8)} games                 ║`);
console.log(`║  Eval every:     ${String(EVAL_EVERY).padStart(8)} games                 ║`);
console.log(`║  Learning rate:  ${String(LR).padStart(8)}                       ║`);
console.log(`║  PPO epochs:     ${String(DEFAULT_PPO_CONFIG.ppoEpochs).padStart(8)}                       ║`);
console.log(`║  Mini-batch:     ${String(DEFAULT_PPO_CONFIG.miniBatchSize).padStart(8)}                       ║`);
console.log(`║  Workers:       ${String(NUM_WORKERS).padStart(8)}                       ║`);
if (RESUME) console.log(`║  Resuming from:  ${String(gamesPlayed).padStart(8)} games                 ║`);
console.log('╚════════════════════════════════════════════════════╝\n');

const trainer = new PPOTrainer(network, {
  ...DEFAULT_PPO_CONFIG,
  rolloutGames: ROLLOUT_GAMES,
  lr: LR,
});

const baselineOpponents = [
  { id: 'RandomBot', strategy: new RandomAI() as import('../../server/src/game/ai/types.js').AIStrategy },
  { id: 'EasyAI', strategy: new EasyAI() as import('../../server/src/game/ai/types.js').AIStrategy },
  { id: 'MediumAI', strategy: new MediumAI() as import('../../server/src/game/ai/types.js').AIStrategy },
  { id: 'AggressiveAI', strategy: new AggressiveAI() as import('../../server/src/game/ai/types.js').AIStrategy },
  { id: 'HoarderAI', strategy: new HoarderAI() as import('../../server/src/game/ai/types.js').AIStrategy },
];

const startTime = Date.now();

// ─── Worker pool setup ──────────────────────────────────────────────────
// Worker path: prefer compiled sibling .mjs (from esbuild), fall back to tsx bootstrap
const thisDir = fileURLToPath(new URL('.', import.meta.url));
const WORKER_COMPILED = new URL('./game-worker.mjs', import.meta.url);  // sibling in dist/
const WORKER_BOOTSTRAP_URL = new URL('./rl/game-worker-bootstrap.mjs', import.meta.url);  // src/ layout
const WORKER_PATH = existsSync(WORKER_COMPILED)
  ? fileURLToPath(WORKER_COMPILED)
  : fileURLToPath(WORKER_BOOTSTRAP_URL);
let workers: Worker[] = [];
let useWorkers = false;

try {
  for (let i = 0; i < NUM_WORKERS; i++) {
    workers.push(new Worker(WORKER_PATH));
  }
  useWorkers = true;
  console.log(`[Workers] Spawned ${NUM_WORKERS} worker threads for parallel game collection`);
} catch (err) {
  console.log(`[Workers] Failed to spawn workers, falling back to single-threaded: ${err}`);
  workers = [];
  useWorkers = false;
}

// ─── Helper: build OpponentSpec[] for workers ────────────────────────────
function buildOpponentSpecs(
  stage: typeof CURRICULUM[0],
  currentNetworkWeights: PPONetworkWeights,
): OpponentSpec[] {
  const specs: OpponentSpec[] = [];
  const heuristicScale = selfPlayActive && selfPlayCheckpoints.length > 0
    ? (100 - SELF_PLAY_WEIGHT) / 100
    : 1;

  for (const bo of baselineOpponents) {
    const w = (stage.opponents as Record<string, number>)[bo.id] ?? 0;
    if (w > 0) {
      const typeMap: Record<string, OpponentSpec['type']> = {
        RandomBot: 'random', EasyAI: 'easy', MediumAI: 'medium', AggressiveAI: 'aggressive', HoarderAI: 'hoarder',
      };
      specs.push({ id: bo.id, type: typeMap[bo.id] ?? 'medium', weight: w * heuristicScale });
    }
  }

  if (selfPlayActive && selfPlayCheckpoints.length > 0) {
    const currentElo = bestElo;
    let leagueWeightSum = 0;
    const leagueWeights: number[] = selfPlayCheckpoints.map(cp => {
      const w = Math.exp(-Math.abs(currentElo - cp.elo) / 100);
      leagueWeightSum += w;
      return w;
    });
    for (let i = 0; i < selfPlayCheckpoints.length; i++) {
      const cp = selfPlayCheckpoints[i];
      const normalizedWeight = (leagueWeights[i] / leagueWeightSum) * SELF_PLAY_WEIGHT;
      specs.push({ id: cp.id, type: 'ppo', weights: cp.weights, weight: normalizedWeight });
    }
  }

  return specs;
}

// ─── Helper: merge collected data from multiple workers ──────────────────
function mergeCollectedData(chunks: CollectedData[]): CollectedData {
  let totalCount = 0;
  const allGameResults: GameResult[] = [];
  for (const chunk of chunks) {
    totalCount += chunk.packed.count;
    allGameResults.push(...chunk.gameResults);
  }

  const inputs = new Float32Array(totalCount * FEATURE_SIZE);
  const masks = new Uint8Array(totalCount * MAX_ACTIONS);
  const actions = new Int32Array(totalCount);
  const logProbs = new Float32Array(totalCount);
  const values = new Float32Array(totalCount);
  const rewards = new Float32Array(totalCount);
  const dones = new Uint8Array(totalCount);

  let offset = 0;
  for (const chunk of chunks) {
    const c = chunk.packed.count;
    inputs.set(chunk.packed.inputs, offset * FEATURE_SIZE);
    masks.set(chunk.packed.masks, offset * MAX_ACTIONS);
    actions.set(chunk.packed.actions, offset);
    logProbs.set(chunk.packed.logProbs, offset);
    values.set(chunk.packed.values, offset);
    rewards.set(chunk.packed.rewards, offset);
    dones.set(chunk.packed.dones, offset);
    offset += c;
  }

  return {
    packed: { count: totalCount, inputs, masks, actions, logProbs, values, rewards, dones },
    gameResults: allGameResults,
  };
}

// ─── Helper: dispatch games to worker pool ──────────────────────────────
function dispatchToWorkers(
  networkWeights: PPONetworkWeights,
  opponentSpecs: OpponentSpec[],
  totalGames: number,
  rewardConfig: Partial<import('./rl/PPOTrainer.js').PPOConfig>,
): Promise<CollectedData[]> {
  const gamesPerWorker = Math.floor(totalGames / workers.length);
  const remainder = totalGames % workers.length;

  return Promise.all(workers.map((worker, i) => {
    const gamesToPlay = gamesPerWorker + (i < remainder ? 1 : 0);
    if (gamesToPlay === 0) return Promise.resolve({ packed: { count: 0, inputs: new Float32Array(0), masks: new Uint8Array(0), actions: new Int32Array(0), logProbs: new Float32Array(0), values: new Float32Array(0), rewards: new Float32Array(0), dones: new Uint8Array(0) }, gameResults: [] } as CollectedData);

    return new Promise<CollectedData>((resolve, reject) => {
      const handler = (msg: { type: string; packed: PackedTransitions; gameResults: GameResult[] }) => {
        if (msg.type === 'results') {
          worker.off('message', handler);
          worker.off('error', errHandler);
          resolve({ packed: msg.packed, gameResults: msg.gameResults });
        }
      };
      const errHandler = (err: Error) => {
        worker.off('message', handler);
        worker.off('error', errHandler);
        reject(err);
      };
      worker.on('message', handler);
      worker.on('error', errHandler);

      const playMsg: PlayBatchMsg = {
        type: 'play-batch',
        networkWeights,
        opponents: opponentSpecs,
        gamesToPlay,
        rewardConfig,
      };
      worker.postMessage(playMsg);
    });
  }));
}

// ─── Main training loop (async for worker await) ────────────────────────
async function runTraining() {
  while (gamesPlayed < TOTAL_GAMES) {
    rolloutNum++;
    const progress = gamesPlayed / TOTAL_GAMES;

    // ─── Curriculum-based opponent weighting ─────────────────────
    const stage = CURRICULUM[currentStage];
    const opponents: { id: string; strategy: import('../../server/src/game/ai/types.js').AIStrategy; weight: number }[] = [];

    {
      const heuristicScale = selfPlayActive && selfPlayCheckpoints.length > 0
        ? (100 - SELF_PLAY_WEIGHT) / 100
        : 1;
      for (const bo of baselineOpponents) {
        const w = (stage.opponents as Record<string, number>)[bo.id] ?? 0;
        if (w > 0) opponents.push({ ...bo, weight: w * heuristicScale });
      }
      if (selfPlayActive && selfPlayCheckpoints.length > 0) {
        const currentElo = bestElo;
        let leagueWeightSum = 0;
        const leagueWeights: number[] = selfPlayCheckpoints.map(cp => {
          const w = Math.exp(-Math.abs(currentElo - cp.elo) / 100);
          leagueWeightSum += w;
          return w;
        });
        for (let i = 0; i < selfPlayCheckpoints.length; i++) {
          const cp = selfPlayCheckpoints[i];
          const normalizedWeight = (leagueWeights[i] / leagueWeightSum) * SELF_PLAY_WEIGHT;
          opponents.push({ id: cp.id, strategy: cp.strategy, weight: normalizedWeight });
        }
      }
    }

    // ─── LR schedule: constant for 95%, then cosine decay to 0.1x ──
    const currentLR = progress < 0.95
      ? LR
      : LR * (0.1 + 0.9 * 0.5 * (1 + Math.cos(Math.PI * (progress - 0.95) / 0.05)));
    trainer.setLR(currentLR);

    // ─── Entropy annealing: linear decay to floor at 80%, then hold ───
    const entropyProgress = Math.min(progress / 0.8, 1.0);
    const entropyCoeff = INITIAL_ENTROPY_COEFF + (FINAL_ENTROPY_COEFF - INITIAL_ENTROPY_COEFF) * entropyProgress;
    trainer.setEntropyCoeff(entropyCoeff);

    // ─── Train one rollout (parallel workers or single-threaded) ──
    let stats: import('./rl/PPOTrainer.js').RolloutStats;

    if (useWorkers && workers.length > 0) {
      try {
        const networkWeights = network.toJSON();
        const opponentSpecs = buildOpponentSpecs(stage, networkWeights);
        const cfg = trainer.getConfig();
        const rewardConfig: Partial<import('./rl/PPOTrainer.js').PPOConfig> = {
          winReward: cfg.winReward,
          loseReward: cfg.loseReward,
          setReward: cfg.setReward,
          propertyReward: cfg.propertyReward,
          rentReward: cfg.rentReward,
          actionReward: cfg.actionReward,
          unusedActionPenalty: cfg.unusedActionPenalty,
          jsnBlockReward: cfg.jsnBlockReward,
          dtrComboReward: cfg.dtrComboReward,
          overpaymentPenalty: cfg.overpaymentPenalty,
        };

        const t0 = performance.now();
        const chunks = await dispatchToWorkers(networkWeights, opponentSpecs, ROLLOUT_GAMES, rewardConfig);
        const t1 = performance.now();
        const mergedData = mergeCollectedData(chunks);
        const t2 = performance.now();
        stats = trainer.trainOnCollectedData(mergedData);
        const t3 = performance.now();
        if (rolloutNum <= 3 || rolloutNum % 10 === 0) {
          console.log(`\n  [Timing] collect: ${((t1-t0)/1000).toFixed(2)}s  merge: ${((t2-t1)/1000).toFixed(2)}s  train: ${((t3-t2)/1000).toFixed(2)}s`);
        }
      } catch (err) {
        // Worker failed — fall back to single-threaded for this rollout
        console.log(`\n[Workers] Error during parallel collection, falling back: ${err}`);
        stats = trainer.trainRollout(opponents);
      }
    } else {
      stats = trainer.trainRollout(opponents);
    }

    gamesPlayed += stats.gamesPlayed;

    // ─── Curriculum promotion check (2p-only WR to avoid multi-player dilution) ──
    rollingWRBuffer2p.push(new Map(stats.winsPerOpponent2p));
    if (rollingWRBuffer2p.length > ROLLING_WINDOW) rollingWRBuffer2p.shift();

    if (currentStage < CURRICULUM.length - 1 && stage.promoteOn) {
      const wr = computeRollingWR2p(stage.promoteOn);
      if (rollingWRBuffer2p.length >= ROLLING_WINDOW && wr > stage.promoteWR) {
        currentStage++;
        console.log(`\n[Curriculum] Promoted to Stage ${currentStage + 1}/${CURRICULUM.length} (${stage.promoteOn} 2p-WR: ${(wr * 100).toFixed(1)}%)`);
        rollingWRBuffer2p.length = 0;
      }
    }

    const totalRollouts = Math.ceil(TOTAL_GAMES / ROLLOUT_GAMES);
    process.stdout.write(
      `\r[Rollout ${String(rolloutNum).padStart(String(totalRollouts).length)}/${totalRollouts}]` +
      `  Games: ${gamesPlayed}/${TOTAL_GAMES}` +
      `  |  Stage: ${currentStage + 1}/${CURRICULUM.length}` +
      `  |  WR: ${(stats.winRate * 100).toFixed(1)}%` +
      `  |  Rew: ${stats.avgReward.toFixed(2)}` +
      `  |  VLoss: ${stats.avgValueLoss.toFixed(3)}` +
      `  |  Ent: ${stats.avgEntropy.toFixed(2)}` +
      `  |  Trans: ${stats.totalTransitions}` +
      `  |  LR: ${currentLR.toFixed(5)}`,
    );

    const logEntry = {
      rollout: rolloutNum,
      gamesPlayed,
      winRate: +stats.winRate.toFixed(4),
      avgReward: +stats.avgReward.toFixed(4),
      avgEntropy: +stats.avgEntropy.toFixed(4),
      avgTurns: +stats.avgTurns.toFixed(1),
      avgValueLoss: +stats.avgValueLoss.toFixed(4),
      avgPolicyLoss: +stats.avgPolicyLoss.toFixed(4),
      totalTransitions: stats.totalTransitions,
      lr: +currentLR.toFixed(6),
      entropyCoeff: +entropyCoeff.toFixed(5),
      winsPerOpponent: Object.fromEntries(stats.winsPerOpponent),
      curriculumStage: currentStage,
      selfPlayActive,
      timestamp: Date.now(),
    };
    appendFileSync(LOG_PATH, JSON.stringify(logEntry) + '\n');

    // ─── Evaluation checkpoint ──────────────────────────────────
    if (gamesPlayed - lastEvalAt >= EVAL_EVERY) {
      lastEvalAt = gamesPlayed;
      const step = gamesPlayed;
      const checkpointId = `ppo_v${step}`;

      const weights = network.toJSON();
      writeFileSync(
        new URL(`../data/checkpoints/${checkpointId}.json`, import.meta.url),
        JSON.stringify(weights),
      );

      const arena = new EloArena();
      arena.registerAgent('RandomBot', new RandomAI(), 1000);
      arena.registerAgent('EasyAI', new EasyAI(), 1000);
      arena.registerAgent('MediumAI', new MediumAI(), 1000);
      arena.registerAgent('AggressiveAI', new AggressiveAI(), 1000);
      arena.registerAgent('HoarderAI', new HoarderAI(), 1000);
      arena.registerAgent(checkpointId, new PPOStrategy(PPONetwork.fromJSON(weights)), 1000, step);

      const report = arena.runRoundRobin(200);
      const rlPlayer = report.players.find(p => p.agentId === checkpointId);
      const elo = rlPlayer ? Math.round(rlPlayer.elo) : 0;
      const vsMedian = report.headToHead.get(checkpointId)?.get('MediumAI');
      const vsMediumWR = vsMedian ? Math.round(100 * vsMedian.wins / (vsMedian.wins + vsMedian.losses + vsMedian.draws)) : 0;

      if (elo > bestElo) {
        bestElo = elo;
        bestCheckpoint = checkpointId;
      }

      // ─── Self-play league management ──────────────────────────
      if (!selfPlayActive && elo > SELF_PLAY_ELO_THRESHOLD) {
        selfPlayActive = true;
        console.log(`\n[Self-play] Activated! Elo ${elo} > ${SELF_PLAY_ELO_THRESHOLD}`);
      }

      // Only add checkpoints that are strong enough to be worth training against
      const leagueMinElo = selfPlayCheckpoints.length > 0
        ? Math.min(...selfPlayCheckpoints.map(cp => cp.elo))
        : -Infinity;
      if (selfPlayActive && (elo > leagueMinElo + 30 || selfPlayCheckpoints.length < MAX_LEAGUE_SIZE)) {
        const checkpointNet = PPONetwork.fromJSON(weights);
        selfPlayCheckpoints.push({ id: checkpointId, strategy: new PPOStrategy(checkpointNet), elo, weights });

        while (selfPlayCheckpoints.length > MAX_LEAGUE_SIZE) {
          selfPlayCheckpoints.shift();
        }
      }

      console.log(
        `\n[Eval @ ${step} games]  Elo: ${elo}  |  vs MediumAI: ${vsMediumWR}%  |  Best: ${bestCheckpoint} (${bestElo})  |  Stage: ${currentStage + 1}/${CURRICULUM.length}  |  SelfPlay: ${selfPlayActive ? 'ON' : 'OFF'}  |  League: ${selfPlayCheckpoints.length}`,
      );

      const tracker = new EloTracker();
      const snapshots: EloSnapshot[] = report.players.map(p => ({
        agentId: p.agentId,
        elo: Math.round(p.elo),
        winRate: p.gamesPlayed > 0 ? +(p.wins / p.gamesPlayed).toFixed(4) : 0,
        gamesPlayed: p.gamesPlayed,
        trainingStep: p.trainingStep ?? null,
        timestamp: Date.now(),
      }));
      tracker.recordRound(snapshots);

      try { generateDashboard(); } catch { /* data files may not be ready */ }

      const leaderboard = report.players.map(p => ({
        agentId: p.agentId,
        elo: Math.round(p.elo),
        gamesPlayed: p.gamesPlayed,
        winRate: p.gamesPlayed > 0 ? +(p.wins / p.gamesPlayed).toFixed(4) : 0,
        trainingStep: p.trainingStep ?? null,
      }));
      writeFileSync(new URL('../data/leaderboard.json', import.meta.url), JSON.stringify(leaderboard, null, 2));

      // Save training state for resume
      const trainingState: TrainingState = {
        gamesPlayed,
        rolloutNum,
        lastEvalAt,
        bestElo,
        bestCheckpoint,
        networkFullState: network.toFullJSON(),
        selfPlayCheckpointIds: selfPlayCheckpoints.map(cp => cp.id),
        curriculumStage: currentStage,
        selfPlayActive,
        selfPlayCheckpointElos: selfPlayCheckpoints.map(cp => ({ id: cp.id, elo: cp.elo })),
      };
      writeFileSync(TRAINING_STATE_PATH, JSON.stringify(trainingState));
    }
  }

  // Terminate workers
  for (const w of workers) w.terminate();
}

// ─── Run training and finalize ──────────────────────────────────────────
runTraining().then(() => {
  console.log('\n');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║              Training Complete!                    ║');
  console.log('╠════════════════════════════════════════════════════╣');
  console.log(`║  Total games:  ${String(gamesPlayed).padStart(8)}                       ║`);
  console.log(`║  Duration:     ${String(elapsed + 's').padStart(8)}                       ║`);
  console.log(`║  Speed:        ${String(Math.round(gamesPlayed / parseFloat(elapsed))).padStart(5)} games/s                    ║`);

  if (bestCheckpoint) {
    console.log(`║  Best model:   ${bestCheckpoint.padEnd(20)}  Elo: ${String(bestElo).padStart(5)} ║`);

    const bestWeightsPath = new URL(`../data/checkpoints/${bestCheckpoint}.json`, import.meta.url);
    if (existsSync(bestWeightsPath)) {
      const bestWeights = readFileSync(bestWeightsPath, 'utf-8');
      const bestModelData = {
        checkpointId: bestCheckpoint,
        elo: bestElo,
        trainedAt: new Date().toISOString(),
        totalGames: gamesPlayed,
        algorithm: 'ppo',
        weights: JSON.parse(bestWeights),
      };
      writeFileSync(BEST_MODEL_PATH, JSON.stringify(bestModelData));
      console.log('╠════════════════════════════════════════════════════╣');
      console.log('║  best-model.json written!                          ║');
      console.log('║  HardAI will use this model on next server start.  ║');
    }
  } else {
    console.log('║  No checkpoint improved over baselines.             ║');
  }

  console.log('╚════════════════════════════════════════════════════╝');

  try { generateDashboard(); } catch { /* ok */ }

  console.log(`\nLog: packages/ai/data/training-log.jsonl`);
  console.log(`Dashboard: packages/ai/data/dashboard.html\n`);
}).catch(err => {
  console.error('\n[Fatal] Training failed:', err);
  for (const w of workers) w.terminate();
  process.exit(1);
});
