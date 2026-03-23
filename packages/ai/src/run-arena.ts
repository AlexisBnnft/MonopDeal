import { writeFileSync, mkdirSync } from 'fs';
import { EloArena } from './EloArena.js';
import { EloTracker, type EloSnapshot } from './EloTracker.js';
import { generateDashboard } from './generate-graphs.js';
import { RandomAI } from '../../server/src/game/ai/RandomAI.js';
import { EasyAI } from '../../server/src/game/ai/EasyAI.js';
import { MediumAI } from '../../server/src/game/ai/MediumAI.js';
import { HardAI } from '../../server/src/game/ai/HardAI.js';

const GAMES_PER_PAIR = parseInt(process.argv[2] || '100', 10);

console.log('\n=== MonopDeal Elo Arena ===\n');
console.log(`Games per pair: ${GAMES_PER_PAIR}\n`);

const arena = new EloArena();

arena.registerAgent('RandomBot', new RandomAI(), 1000);
arena.registerAgent('EasyAI', new EasyAI(), 1000);
arena.registerAgent('MediumAI', new MediumAI(), 1000);
arena.registerAgent('HardAI', new HardAI(), 1000);

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
  const name = p.agentId.padEnd(12);
  const eloStr = String(elo).padStart(5);
  const wrStr = (winRate + '%').padStart(7);
  const gp = String(p.gamesPlayed).padStart(4);
  console.log(`║  ${name}  Elo: ${eloStr}  |  Win: ${wrStr}  |  Games: ${gp}  ║`);
}

console.log('╚══════════════════════════════════════════════════════════╝');

// ─── Head-to-Head Matrix ─────────────────────────────────────────────

console.log('\n--- Head-to-Head Win Rates ---\n');

const agentIds = report.players.map(p => p.agentId);
const colW = 12;
process.stdout.write(''.padEnd(colW));
for (const id of agentIds) process.stdout.write(id.padEnd(colW));
console.log();

for (const id of agentIds) {
  process.stdout.write(id.padEnd(colW));
  const h2h = report.headToHead.get(id);
  for (const otherId of agentIds) {
    if (id === otherId) {
      process.stdout.write('---'.padEnd(colW));
    } else {
      const record = h2h?.get(otherId);
      if (record) {
        const total = record.wins + record.losses + record.draws;
        const wr = total > 0 ? ((record.wins / total) * 100).toFixed(0) + '%' : 'N/A';
        process.stdout.write(wr.padEnd(colW));
      } else {
        process.stdout.write('N/A'.padEnd(colW));
      }
    }
  }
  console.log();
}

// ─── Game Length Stats ───────────────────────────────────────────────

const turnsByWinner = new Map<string, number[]>();
for (const m of report.matchResults) {
  if (m.winnerId) {
    if (!turnsByWinner.has(m.winnerId)) turnsByWinner.set(m.winnerId, []);
    turnsByWinner.get(m.winnerId)!.push(m.turns);
  }
}

console.log('\n--- Average Game Length (turns) by Winner ---\n');
for (const id of agentIds) {
  const turns = turnsByWinner.get(id);
  if (turns && turns.length > 0) {
    const avg = (turns.reduce((a, b) => a + b, 0) / turns.length).toFixed(1);
    console.log(`  ${id.padEnd(12)} avg ${avg} turns  (${turns.length} wins)`);
  } else {
    console.log(`  ${id.padEnd(12)} no wins`);
  }
}

// ─── Save Results ────────────────────────────────────────────────────

mkdirSync(new URL('../data', import.meta.url), { recursive: true });

const leaderboard = report.players.map(p => ({
  agentId: p.agentId,
  elo: Math.round(p.elo),
  gamesPlayed: p.gamesPlayed,
  winRate: p.gamesPlayed > 0 ? +(p.wins / p.gamesPlayed).toFixed(4) : 0,
  trainingStep: p.trainingStep ?? null,
}));

writeFileSync(
  new URL('../data/leaderboard.json', import.meta.url),
  JSON.stringify(leaderboard, null, 2),
);

// ─── Track Elo Progression ──────────────────────────────────────────

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
tracker.printProgression();

// ─── Convergence Check ──────────────────────────────────────────────

for (const p of report.players) {
  if (p.trainingStep != null) {
    const converged = tracker.hasConverged(p.agentId);
    const beatsMedium = tracker.consistentlyBeats(p.agentId, 'MediumAI');
    if (converged) console.log(`\n  [Convergence] ${p.agentId} Elo has stabilized.`);
    if (beatsMedium) console.log(`  [Milestone] ${p.agentId} consistently beats MediumAI!`);
  }
}

// ─── Generate Dashboard ─────────────────────────────────────────────

generateDashboard();

console.log('\nResults saved to packages/ai/data/\n');
