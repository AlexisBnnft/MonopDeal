import { readFileSync, existsSync } from 'fs';
import { EloArena } from './EloArena.js';
import { PPONetwork, type PPONetworkWeights, type PPOFullState } from './rl/PPONetwork.js';
import { PPOStrategy } from './rl/PPOStrategy.js';
import { RandomAI } from '../../server/src/game/ai/RandomAI.js';
import { EasyAI } from '../../server/src/game/ai/EasyAI.js';
import { MediumAI } from '../../server/src/game/ai/MediumAI.js';

// ─── CLI args ────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  let modelPath = '';
  let useLatest = false;
  let games = 100;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) modelPath = args[++i];
    else if (args[i] === '--games' && args[i + 1]) games = parseInt(args[++i], 10);
    else if (args[i] === '--latest') useLatest = true;
  }

  if (!modelPath && !useLatest) {
    // Default: try training-state.json first (has the freshest weights), then best-model.json
    const statePath = new URL('../data/training-state.json', import.meta.url).pathname;
    if (existsSync(statePath)) {
      modelPath = statePath;
      useLatest = true;
    } else {
      modelPath = new URL('../data/best-model.json', import.meta.url).pathname;
    }
  }

  return { modelPath, useLatest, games };
}

const { modelPath, useLatest, games: GAMES_PER_PAIR } = parseArgs();

// ─── Load model ──────────────────────────────────────────────────────────
if (!existsSync(modelPath)) {
  console.error(`Model not found: ${modelPath}`);
  process.exit(1);
}

let ppoNetwork: PPONetwork;
let modelLabel: string;
let gamesTrainedOn: number | null = null;

if (useLatest || modelPath.includes('training-state')) {
  // Load from training state — always has the freshest in-training weights
  const state = JSON.parse(readFileSync(modelPath, 'utf-8'));
  ppoNetwork = PPONetwork.fromFullJSON(state.networkFullState);
  gamesTrainedOn = state.gamesPlayed;
  modelLabel = `PPO@${state.gamesPlayed}`;
} else {
  const raw = JSON.parse(readFileSync(modelPath, 'utf-8'));
  const weights: PPONetworkWeights = raw.weights ?? raw;
  ppoNetwork = PPONetwork.fromJSON(weights);
  modelLabel = raw.checkpointId ?? 'PPO';
  gamesTrainedOn = raw.totalGames ?? null;
}

const ppoStrategy = new PPOStrategy(ppoNetwork, false);

// ─── Arena ───────────────────────────────────────────────────────────────
console.log('\n=== MonopDeal Quick Eval ===\n');
console.log(`Model: ${modelLabel}${gamesTrainedOn ? ` (${gamesTrainedOn.toLocaleString()} training games)` : ''}`);
console.log(`Games per pair: ${GAMES_PER_PAIR}\n`);

const arena = new EloArena();
arena.registerAgent('RandomBot', new RandomAI(), 1000);
arena.registerAgent('EasyAI', new EasyAI(), 1000);
arena.registerAgent('MediumAI', new MediumAI(), 1000);
arena.registerAgent(modelLabel, ppoStrategy, 1000);

console.log('Running round-robin tournament...\n');
const startTime = Date.now();

const report = arena.runRoundRobin(GAMES_PER_PAIR);

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
const totalGames = report.matchResults.length;
console.log(`Completed ${totalGames} games in ${elapsed}s (${(totalGames / parseFloat(elapsed)).toFixed(0)} games/s)\n`);

// ─── Leaderboard ─────────────────────────────────────────────────────
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║                    ELO LEADERBOARD                      ║');
console.log('╠══════════════════════════════════════════════════════════╣');

for (const p of report.players) {
  const winRate = p.gamesPlayed > 0 ? ((p.wins / p.gamesPlayed) * 100).toFixed(1) : '0.0';
  const elo = Math.round(p.elo);
  const name = p.agentId.padEnd(14);
  const eloStr = String(elo).padStart(5);
  const wrStr = (winRate + '%').padStart(7);
  const gp = String(p.gamesPlayed).padStart(4);
  console.log(`║  ${name}Elo: ${eloStr}  |  Win: ${wrStr}  |  Games: ${gp}  ║`);
}

console.log('╚══════════════════════════════════════════════════════════╝');

// ─── Head-to-Head Matrix ─────────────────────────────────────────────
console.log('\n--- Head-to-Head Win Rates ---\n');

const agentIds = report.players.map(p => p.agentId);
const colW = 14;
process.stdout.write(''.padEnd(colW));
for (const id of agentIds) process.stdout.write(id.padStart(colW));
console.log();

for (const id of agentIds) {
  process.stdout.write(id.padEnd(colW));
  const h2h = report.headToHead.get(id);
  for (const otherId of agentIds) {
    if (id === otherId) {
      process.stdout.write('---'.padStart(colW));
    } else {
      const record = h2h?.get(otherId);
      if (record) {
        const total = record.wins + record.losses + record.draws;
        const wr = total > 0 ? ((record.wins / total) * 100).toFixed(0) + '%' : 'N/A';
        process.stdout.write(wr.padStart(colW));
      } else {
        process.stdout.write('N/A'.padStart(colW));
      }
    }
  }
  console.log();
}

// ─── Result summary ──────────────────────────────────────────────────
const ppoPlayer = report.players.find(p => p.agentId === modelLabel);
const mediumPlayer = report.players.find(p => p.agentId === 'MediumAI');

if (ppoPlayer && mediumPlayer) {
  const ppoElo = Math.round(ppoPlayer.elo);
  const medElo = Math.round(mediumPlayer.elo);
  const beatsMedium = ppoElo > medElo;

  const h2h = report.headToHead.get(modelLabel);
  const vsMed = h2h?.get('MediumAI');
  const vsEasy = h2h?.get('EasyAI');
  const vsRand = h2h?.get('RandomBot');
  const wrVsMed = vsMed ? Math.round(100 * vsMed.wins / (vsMed.wins + vsMed.losses + vsMed.draws)) : 0;
  const wrVsEasy = vsEasy ? Math.round(100 * vsEasy.wins / (vsEasy.wins + vsEasy.losses + vsEasy.draws)) : 0;
  const wrVsRand = vsRand ? Math.round(100 * vsRand.wins / (vsRand.wins + vsRand.losses + vsRand.draws)) : 0;

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                      SUMMARY                            ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  ${modelLabel.padEnd(14)}Elo: ${String(ppoElo).padStart(5)}                          ║`);
  console.log(`║  vs RandomBot:  ${String(wrVsRand + '%').padStart(4)}    vs EasyAI:  ${String(wrVsEasy + '%').padStart(4)}            ║`);
  console.log(`║  vs MediumAI:   ${String(wrVsMed + '%').padStart(4)}    (MediumAI Elo: ${String(medElo).padStart(5)})        ║`);
  console.log(`║                                                          ║`);
  if (beatsMedium) {
    console.log(`║  Status: BEATS MediumAI!                                 ║`);
  } else {
    const gap = medElo - ppoElo;
    console.log(`║  Status: Below MediumAI (${String(gap).padStart(3)} Elo gap)                    ║`);
  }
  console.log('╚══════════════════════════════════════════════════════════╝\n');
} else {
  console.error('Could not find PPO or MediumAI in results');
  process.exit(1);
}
