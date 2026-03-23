import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';

interface EloSnapshot {
  agentId: string;
  elo: number;
  winRate: number;
  gamesPlayed: number;
  trainingStep: number | null;
  timestamp: number;
}

interface ProgressionEntry {
  round: number;
  timestamp: number;
  snapshots: EloSnapshot[];
}

interface LeaderboardEntry {
  agentId: string;
  elo: number;
  gamesPlayed: number;
  winRate: number;
  trainingStep: number | null;
}

interface TrainingLogEntry {
  rollout: number;
  gamesPlayed: number;
  winRate: number;
  avgReward: number;
  avgEntropy: number;
  avgTurns: number;
  avgValueLoss: number;
  avgPolicyLoss: number;
  totalTransitions: number;
  lr: number;
  entropyCoeff: number;
  winsPerOpponent: Record<string, { wins: number; total: number }>;
  curriculumStage: number;
  selfPlayActive: boolean;
  timestamp: number;
}

// Warm, muted palette for a light editorial look
const AGENT_CHART_COLORS: Record<string, string> = {
  RandomBot: '#b0a899',
  EasyAI:    '#c9943e',
  MediumAI:  '#3663a1',
  HardAI:    '#b4423c',
};
const PPO_COLOR = '#1a7a54';

function chartColorFor(agentId: string): string {
  if (agentId.startsWith('ppo_')) return PPO_COLOR;
  return AGENT_CHART_COLORS[agentId] ?? PPO_COLOR;
}

export function generateDashboard(): string {
  const dataDir = new URL('../data', import.meta.url);
  mkdirSync(dataDir, { recursive: true });

  const progression: ProgressionEntry[] = JSON.parse(
    readFileSync(new URL('../data/elo-progression.json', import.meta.url), 'utf-8'),
  );
  const leaderboard: LeaderboardEntry[] = JSON.parse(
    readFileSync(new URL('../data/leaderboard.json', import.meta.url), 'utf-8'),
  );

  const logPath = new URL('../data/training-log.jsonl', import.meta.url);
  let trainingLog: TrainingLogEntry[] = [];
  if (existsSync(logPath)) {
    const raw = readFileSync(logPath, 'utf-8').trim();
    if (raw) {
      trainingLog = raw.split('\n').map(line => JSON.parse(line));
    }
  }

  const allAgents = new Set<string>();
  for (const entry of progression) {
    for (const snap of entry.snapshots) allAgents.add(snap.agentId);
  }
  for (const entry of leaderboard) allAgents.add(entry.agentId);
  const agents = [...allAgents];

  const rounds = progression.map(e => e.round);

  const eloDatasets = agents.map(id => {
    const color = chartColorFor(id);
    const data = progression.map(entry => {
      const snap = entry.snapshots.find(s => s.agentId === id);
      return snap ? Math.round(snap.elo) : null;
    });
    return { label: id, data, borderColor: color, backgroundColor: 'transparent', fill: false, tension: 0.35, pointRadius: 3, pointBackgroundColor: color, borderWidth: 1.5 };
  });

  const winRateDatasets = agents.map(id => {
    const color = chartColorFor(id);
    const data = progression.map(entry => {
      const snap = entry.snapshots.find(s => s.agentId === id);
      return snap ? +(snap.winRate * 100).toFixed(1) : null;
    });
    return { label: id, data, borderColor: color, backgroundColor: 'transparent', fill: false, tension: 0.35, pointRadius: 3, pointBackgroundColor: color, borderWidth: 1.5 };
  });

  const sortedLeaderboard = [...leaderboard].sort((a, b) => b.elo - a.elo);
  const barLabels = sortedLeaderboard.map(e => e.agentId);
  const barElos = sortedLeaderboard.map(e => e.elo);
  const barColors = sortedLeaderboard.map(e => chartColorFor(e.agentId));

  // Training log data
  const logGames = trainingLog.map(e => e.gamesPlayed);
  const logWR = trainingLog.map(e => +(e.winRate * 100).toFixed(1));
  const logReward = trainingLog.map(e => +e.avgReward.toFixed(2));
  const logEntropy = trainingLog.map(e => +e.avgEntropy.toFixed(3));
  const logValueLoss = trainingLog.map(e => +e.avgValueLoss.toFixed(3));
  const logPolicyLoss = trainingLog.map(e => +e.avgPolicyLoss.toFixed(4));
  const logTurns = trainingLog.map(e => +e.avgTurns.toFixed(1));
  const logTransitions = trainingLog.map(e => e.totalTransitions);
  const logLR = trainingLog.map(e => e.lr);
  const logEntropyCoeff = trainingLog.map(e => e.entropyCoeff);
  const logStage = trainingLog.map(e => e.curriculumStage + 1);

  const opponentNames = ['MediumAI', 'EasyAI', 'RandomBot'];
  const oppWRData: Record<string, (number | null)[]> = {};
  for (const name of opponentNames) {
    oppWRData[name] = trainingLog.map(e => {
      const opp = e.winsPerOpponent[name];
      if (!opp || opp.total === 0) return null;
      return +((opp.wins / opp.total) * 100).toFixed(1);
    });
  }

  const lastLog = trainingLog.length > 0 ? trainingLog[trainingLog.length - 1] : null;
  const totalGames = lastLog?.gamesPlayed ?? 0;
  const generatedAt = new Date().toLocaleString();
  const bestElo = leaderboard.reduce((best, e) => {
    if (e.trainingStep !== null && e.elo > best) return e.elo;
    return best;
  }, 0);
  const ppoEntry = leaderboard.find(e => e.trainingStep !== null);
  const mediumEntry = leaderboard.find(e => e.agentId === 'MediumAI');
  const totalRollouts = trainingLog.length;
  const firstTs = trainingLog.length > 0 ? trainingLog[0].timestamp : 0;
  const lastTs = lastLog?.timestamp ?? 0;
  const durationSec = (lastTs - firstTs) / 1000;
  const durationMin = durationSec > 0 ? (durationSec / 60).toFixed(1) : '0';
  const gamesPerSec = durationSec > 0 ? Math.round(totalGames / durationSec) : 0;

  const stageChanges: { game: number; stage: number }[] = [];
  let prevStage = -1;
  for (const entry of trainingLog) {
    if (entry.curriculumStage !== prevStage) {
      stageChanges.push({ game: entry.gamesPlayed, stage: entry.curriculumStage + 1 });
      prevStage = entry.curriculumStage;
    }
  }

  // Leaderboard table rows
  const lbRows = sortedLeaderboard.map((e, i) => {
    const isPPO = e.trainingStep !== null;
    return `<tr${isPPO ? ' class="ppo-row"' : ''}>
      <td class="rank">${i + 1}</td>
      <td class="agent-name">${e.agentId}</td>
      <td class="num">${Math.round(e.elo)}</td>
      <td class="num">${(e.winRate * 100).toFixed(1)}%</td>
      <td class="num dim">${e.gamesPlayed}</td>
    </tr>`;
  }).join('\n');

  const ppoBeatingMedium = ppoEntry && mediumEntry && ppoEntry.elo >= mediumEntry.elo;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MonopDeal PPO &mdash; Training Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3"></script>
<style>
:root {
  --sand-50: #faf9f7;
  --sand-100: #f3f1ed;
  --sand-200: #e8e4dd;
  --sand-300: #d4cfc5;
  --sand-400: #b0a899;
  --sand-500: #8a8174;
  --sand-600: #6b6358;
  --sand-700: #4a443c;
  --sand-800: #2e2a25;
  --sand-900: #1a1815;

  --green: #1a7a54;
  --green-light: #e8f5ee;
  --blue: #3663a1;
  --amber: #c9943e;
  --red: #b4423c;
  --red-light: #fdf0ef;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'DM Sans', sans-serif;
  background: var(--sand-50);
  color: var(--sand-800);
  -webkit-font-smoothing: antialiased;
}

.page {
  max-width: 1120px;
  margin: 0 auto;
  padding: clamp(1.5rem, 4vw, 3rem) clamp(1rem, 3vw, 2rem);
}

/* ─── Header ─────────────────────────────── */
header {
  padding-bottom: 2rem;
  margin-bottom: 2rem;
  border-bottom: 1px solid var(--sand-200);
}

header h1 {
  font-size: clamp(1.4rem, 2.5vw, 1.75rem);
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--sand-900);
  margin-bottom: 0.35rem;
}

.meta {
  font-size: 0.8rem;
  color: var(--sand-500);
  font-family: 'DM Mono', monospace;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
}

/* ─── KPI strip ──────────────────────────── */
.kpi-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  margin-bottom: 2.5rem;
  border: 1px solid var(--sand-200);
  border-radius: 6px;
  overflow: hidden;
  background: white;
}

.kpi {
  flex: 1 1 0;
  min-width: 120px;
  padding: 1rem 1.25rem;
  border-right: 1px solid var(--sand-200);
}
.kpi:last-child { border-right: none; }

.kpi-val {
  font-size: 1.35rem;
  font-weight: 600;
  font-family: 'DM Mono', monospace;
  letter-spacing: -0.03em;
  color: var(--sand-900);
  line-height: 1.1;
}
.kpi-val.accent { color: var(--green); }
.kpi-val.warn { color: var(--amber); }

.kpi-label {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--sand-500);
  margin-top: 0.3rem;
}

/* ─── Sections ───────────────────────────── */
.section {
  margin-bottom: 3rem;
}

.section-label {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--sand-500);
  margin-bottom: 1.25rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--sand-200);
}

/* ─── Chart layout ───────────────────────── */
.chart-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem 2.5rem;
  margin-bottom: 2rem;
}
.chart-row.full { grid-template-columns: 1fr; }
.chart-row.third { grid-template-columns: 1fr 1fr 1fr; }

@media (max-width: 760px) {
  .chart-row, .chart-row.third { grid-template-columns: 1fr; }
}

.chart-cell {
  min-width: 0;
}

.chart-title {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--sand-700);
  margin-bottom: 0.75rem;
}

canvas {
  width: 100% !important;
  max-height: 280px;
}

/* ─── Leaderboard table ──────────────────── */
.lb-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}
.lb-table th {
  text-align: left;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--sand-500);
  font-weight: 500;
  padding: 0 0 0.5rem;
  border-bottom: 1px solid var(--sand-200);
}
.lb-table th.r { text-align: right; }
.lb-table td {
  padding: 0.55rem 0;
  border-bottom: 1px solid var(--sand-100);
  color: var(--sand-700);
}
.lb-table .rank {
  width: 2rem;
  color: var(--sand-400);
  font-family: 'DM Mono', monospace;
  font-size: 0.75rem;
}
.lb-table .agent-name { font-weight: 500; color: var(--sand-800); }
.lb-table .num {
  text-align: right;
  font-family: 'DM Mono', monospace;
  font-size: 0.8rem;
}
.lb-table .dim { color: var(--sand-400); }
.lb-table .ppo-row .agent-name { color: var(--green); }
.lb-table .ppo-row .num { color: var(--green); }
.lb-table .ppo-row .dim { color: var(--sand-400); }

/* ─── Split layout for leaderboard + bar ── */
.split {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 2.5rem;
  align-items: start;
}
@media (max-width: 760px) { .split { grid-template-columns: 1fr; } }

/* ─── Status pill ────────────────────────── */
.pill {
  display: inline-block;
  font-size: 0.65rem;
  font-family: 'DM Mono', monospace;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0.15rem 0.5rem;
  border-radius: 3px;
  vertical-align: middle;
}
.pill.on { background: var(--green-light); color: var(--green); }
.pill.off { background: var(--sand-100); color: var(--sand-500); }

/* ─── Footer ─────────────────────────────── */
footer {
  margin-top: 3rem;
  padding-top: 1rem;
  border-top: 1px solid var(--sand-200);
  font-size: 0.7rem;
  color: var(--sand-400);
  font-family: 'DM Mono', monospace;
}
</style>
</head>
<body>
<div class="page">

<header>
  <h1>MonopDeal PPO Training Report</h1>
  <div class="meta">
    <span>${generatedAt}</span>
    <span>${totalRollouts} rollouts</span>
    <span>${totalGames.toLocaleString()} games</span>
    <span>${durationMin} min</span>
    <span>${gamesPerSec} g/s</span>
  </div>
</header>

<!-- KPI strip -->
<div class="kpi-strip">
  <div class="kpi">
    <div class="kpi-val accent">${bestElo || '---'}</div>
    <div class="kpi-label">Best PPO Elo</div>
  </div>
  <div class="kpi">
    <div class="kpi-val ${ppoBeatingMedium ? 'accent' : 'warn'}">${ppoEntry ? (ppoEntry.winRate * 100).toFixed(1) + '%' : '---'}</div>
    <div class="kpi-label">PPO Arena WR</div>
  </div>
  <div class="kpi">
    <div class="kpi-val">${mediumEntry ? mediumEntry.elo : '---'}</div>
    <div class="kpi-label">MediumAI Elo</div>
  </div>
  <div class="kpi">
    <div class="kpi-val">${lastLog ? (lastLog.curriculumStage + 1) : '-'}<span style="font-size:0.75em;color:var(--sand-400)">/4</span></div>
    <div class="kpi-label">Curriculum</div>
  </div>
  <div class="kpi">
    <div class="kpi-val"><span class="pill ${lastLog?.selfPlayActive ? 'on' : 'off'}">${lastLog?.selfPlayActive ? 'Active' : 'Off'}</span></div>
    <div class="kpi-label">Self-Play</div>
  </div>
  <div class="kpi">
    <div class="kpi-val">${lastLog ? lastLog.avgEntropy.toFixed(2) : '---'}</div>
    <div class="kpi-label">Entropy</div>
  </div>
  <div class="kpi">
    <div class="kpi-val">${gamesPerSec}</div>
    <div class="kpi-label">Games / sec</div>
  </div>
</div>

<!-- ═══ Arena ═══ -->
<div class="section">
  <div class="section-label">Arena Evaluation</div>

  <div class="split">
    <div>
      <table class="lb-table">
        <thead><tr>
          <th></th><th>Agent</th><th class="r">Elo</th><th class="r">WR</th><th class="r">Games</th>
        </tr></thead>
        <tbody>${lbRows}</tbody>
      </table>
    </div>
    <div class="chart-cell">
      <div class="chart-title">Elo over eval rounds</div>
      <canvas id="eloChart"></canvas>
    </div>
  </div>

  <div class="chart-row" style="margin-top:2rem">
    <div class="chart-cell">
      <div class="chart-title">Arena win rate (%)</div>
      <canvas id="wrChart"></canvas>
    </div>
    <div class="chart-cell">
      <div class="chart-title">Per-opponent training WR (%)</div>
      <canvas id="oppWR"></canvas>
    </div>
  </div>
</div>

<!-- ═══ Training ═══ -->
<div class="section">
  <div class="section-label">Training Dynamics</div>

  <div class="chart-row full">
    <div class="chart-cell">
      <div class="chart-title">Training win rate &amp; curriculum stage</div>
      <canvas id="trainWR"></canvas>
    </div>
  </div>

  <div class="chart-row">
    <div class="chart-cell">
      <div class="chart-title">Average reward</div>
      <canvas id="trainReward"></canvas>
    </div>
    <div class="chart-cell">
      <div class="chart-title">Average turns per game</div>
      <canvas id="trainTurns"></canvas>
    </div>
  </div>
</div>

<!-- ═══ Optimization ═══ -->
<div class="section">
  <div class="section-label">Optimization</div>

  <div class="chart-row">
    <div class="chart-cell">
      <div class="chart-title">Value loss</div>
      <canvas id="trainVLoss"></canvas>
    </div>
    <div class="chart-cell">
      <div class="chart-title">Policy loss</div>
      <canvas id="trainPLoss"></canvas>
    </div>
  </div>

  <div class="chart-row third">
    <div class="chart-cell">
      <div class="chart-title">Entropy &amp; coefficient</div>
      <canvas id="trainEntropy"></canvas>
    </div>
    <div class="chart-cell">
      <div class="chart-title">Learning rate</div>
      <canvas id="trainLR"></canvas>
    </div>
    <div class="chart-cell">
      <div class="chart-title">Transitions / rollout</div>
      <canvas id="trainTrans"></canvas>
    </div>
  </div>
</div>

<footer>MonopDeal PPO &middot; ${totalRollouts} rollouts &middot; ${totalGames.toLocaleString()} games &middot; best ${bestElo}</footer>

</div><!-- .page -->

<script>
const rounds = ${JSON.stringify(rounds)};
const eloDatasets = ${JSON.stringify(eloDatasets)};
const wrDatasets = ${JSON.stringify(winRateDatasets)};
const logGames = ${JSON.stringify(logGames)};
const logWR = ${JSON.stringify(logWR)};
const logReward = ${JSON.stringify(logReward)};
const logEntropy = ${JSON.stringify(logEntropy)};
const logValueLoss = ${JSON.stringify(logValueLoss)};
const logPolicyLoss = ${JSON.stringify(logPolicyLoss)};
const logTurns = ${JSON.stringify(logTurns)};
const logTransitions = ${JSON.stringify(logTransitions)};
const logLR = ${JSON.stringify(logLR)};
const logEntropyCoeff = ${JSON.stringify(logEntropyCoeff)};
const logStage = ${JSON.stringify(logStage)};
const oppWRData = ${JSON.stringify(oppWRData)};
const stageChanges = ${JSON.stringify(stageChanges)};

/* ─── Chart.js global defaults ─────────── */
Chart.defaults.font.family = "'DM Sans', sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.color = '#8a8174';
Chart.defaults.borderColor = '#e8e4dd';
Chart.defaults.plugins.legend.labels.boxWidth = 10;
Chart.defaults.plugins.legend.labels.boxHeight = 2;
Chart.defaults.plugins.legend.labels.padding = 14;
Chart.defaults.plugins.legend.labels.font = { size: 11 };
Chart.defaults.elements.point.hitRadius = 8;

const gridOpts = { color: '#f3f1ed', lineWidth: 1 };
const tickOpts = { font: { family: "'DM Mono', monospace", size: 10 }, color: '#b0a899' };

function stageAnnotations() {
  const a = {};
  stageChanges.forEach((sc, i) => {
    if (i === 0) return;
    a['s' + i] = {
      type: 'line', xMin: sc.game, xMax: sc.game,
      borderColor: '#d4cfc5', borderWidth: 1, borderDash: [3, 3],
      label: { display: true, content: 'S' + sc.stage, position: 'start',
               color: '#b0a899', font: { family: "'DM Mono', monospace", size: 9, weight: '500' },
               backgroundColor: 'rgba(250,249,247,0.85)', padding: { x: 3, y: 1 } }
    };
  });
  return a;
}

function xGames(title) {
  return { title: { display: !!title, text: title || '', font: { size: 10 } }, grid: gridOpts, ticks: tickOpts };
}
function yAxis(title, extra) {
  return { title: { display: !!title, text: title || '', font: { size: 10 } }, grid: gridOpts, ticks: tickOpts, ...extra };
}

/* ─── Arena: Elo progression ─────────────── */
new Chart(document.getElementById('eloChart'), {
  type: 'line',
  data: { labels: rounds, datasets: eloDatasets },
  options: {
    responsive: true, aspectRatio: 2,
    plugins: { legend: { position: 'bottom' } },
    scales: { x: xGames(''), y: yAxis('') }
  }
});

/* ─── Arena: Win rate progression ────────── */
new Chart(document.getElementById('wrChart'), {
  type: 'line',
  data: { labels: rounds, datasets: wrDatasets },
  options: {
    responsive: true, aspectRatio: 2,
    plugins: { legend: { position: 'bottom' } },
    scales: { x: xGames(''), y: yAxis('', { min: 0, max: 100 }) }
  }
});

/* ─── Per-opponent WR ────────────────────── */
new Chart(document.getElementById('oppWR'), {
  type: 'line',
  data: {
    labels: logGames,
    datasets: [
      { label: 'vs MediumAI', data: oppWRData['MediumAI'] || [], borderColor: '#3663a1', fill: false, tension: 0.35, pointRadius: 0, borderWidth: 1.5, spanGaps: true },
      { label: 'vs EasyAI', data: oppWRData['EasyAI'] || [], borderColor: '#c9943e', fill: false, tension: 0.35, pointRadius: 0, borderWidth: 1.5, spanGaps: true },
      { label: 'vs RandomBot', data: oppWRData['RandomBot'] || [], borderColor: '#b0a899', fill: false, tension: 0.35, pointRadius: 0, borderWidth: 1.5, spanGaps: true },
    ]
  },
  options: {
    responsive: true, aspectRatio: 2,
    plugins: { legend: { position: 'bottom' }, annotation: { annotations: stageAnnotations() } },
    scales: { x: xGames(''), y: yAxis('', { min: 0, max: 100 }) }
  }
});

/* ─── Training WR + curriculum stage ─────── */
new Chart(document.getElementById('trainWR'), {
  type: 'line',
  data: {
    labels: logGames,
    datasets: [
      { label: 'Win Rate (%)', data: logWR, borderColor: '#1a7a54', backgroundColor: 'rgba(26,122,84,0.06)',
        fill: true, tension: 0.35, pointRadius: 0, borderWidth: 1.5, yAxisID: 'y' },
      { label: 'Curriculum Stage', data: logStage, borderColor: '#c9943e', backgroundColor: 'transparent',
        fill: false, tension: 0, pointRadius: 0, borderWidth: 1, borderDash: [3,3], yAxisID: 'y2', stepped: true },
    ]
  },
  options: {
    responsive: true, aspectRatio: 3.5,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'bottom' }, annotation: { annotations: stageAnnotations() } },
    scales: {
      x: xGames(''),
      y: yAxis('', { min: 0, max: 100, position: 'left' }),
      y2: { position: 'right', min: 0, max: 5, grid: { drawOnChartArea: false }, ticks: { ...tickOpts, stepSize: 1 } }
    }
  }
});

/* ─── Reward ─────────────────────────────── */
new Chart(document.getElementById('trainReward'), {
  type: 'line',
  data: {
    labels: logGames,
    datasets: [{ data: logReward, borderColor: '#1a7a54', backgroundColor: 'rgba(26,122,84,0.05)',
      fill: true, tension: 0.35, pointRadius: 0, borderWidth: 1.5 }]
  },
  options: {
    responsive: true, aspectRatio: 2,
    plugins: { legend: { display: false }, annotation: { annotations: stageAnnotations() } },
    scales: { x: xGames(''), y: yAxis('') }
  }
});

/* ─── Turns ──────────────────────────────── */
new Chart(document.getElementById('trainTurns'), {
  type: 'line',
  data: {
    labels: logGames,
    datasets: [{ data: logTurns, borderColor: '#3663a1', backgroundColor: 'rgba(54,99,161,0.05)',
      fill: true, tension: 0.35, pointRadius: 0, borderWidth: 1.5 }]
  },
  options: {
    responsive: true, aspectRatio: 2,
    plugins: { legend: { display: false }, annotation: { annotations: stageAnnotations() } },
    scales: { x: xGames(''), y: yAxis('', { min: 0 }) }
  }
});

/* ─── Value loss ─────────────────────────── */
new Chart(document.getElementById('trainVLoss'), {
  type: 'line',
  data: {
    labels: logGames,
    datasets: [{ data: logValueLoss, borderColor: '#b4423c', backgroundColor: 'rgba(180,66,60,0.05)',
      fill: true, tension: 0.35, pointRadius: 0, borderWidth: 1.5 }]
  },
  options: {
    responsive: true, aspectRatio: 2,
    plugins: { legend: { display: false }, annotation: { annotations: stageAnnotations() } },
    scales: { x: xGames(''), y: yAxis('', { min: 0 }) }
  }
});

/* ─── Policy loss ────────────────────────── */
new Chart(document.getElementById('trainPLoss'), {
  type: 'line',
  data: {
    labels: logGames,
    datasets: [{ data: logPolicyLoss, borderColor: '#6b6358', backgroundColor: 'rgba(107,99,88,0.05)',
      fill: true, tension: 0.35, pointRadius: 0, borderWidth: 1.5 }]
  },
  options: {
    responsive: true, aspectRatio: 2,
    plugins: { legend: { display: false }, annotation: { annotations: stageAnnotations() } },
    scales: { x: xGames(''), y: yAxis('') }
  }
});

/* ─── Entropy + coeff ────────────────────── */
new Chart(document.getElementById('trainEntropy'), {
  type: 'line',
  data: {
    labels: logGames,
    datasets: [
      { label: 'Entropy', data: logEntropy, borderColor: '#1a7a54', fill: false, tension: 0.35, pointRadius: 0, borderWidth: 1.5, yAxisID: 'y' },
      { label: 'Coeff', data: logEntropyCoeff, borderColor: '#c9943e', fill: false, tension: 0, pointRadius: 0, borderWidth: 1, borderDash: [3,3], yAxisID: 'y2' },
    ]
  },
  options: {
    responsive: true, aspectRatio: 1.4,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'bottom' }, annotation: { annotations: stageAnnotations() } },
    scales: {
      x: xGames(''),
      y: yAxis('', { position: 'left' }),
      y2: { position: 'right', grid: { drawOnChartArea: false }, ticks: tickOpts }
    }
  }
});

/* ─── LR ─────────────────────────────────── */
new Chart(document.getElementById('trainLR'), {
  type: 'line',
  data: {
    labels: logGames,
    datasets: [{ data: logLR, borderColor: '#6b6358', fill: false, tension: 0, pointRadius: 0, borderWidth: 1.5 }]
  },
  options: {
    responsive: true, aspectRatio: 1.4,
    plugins: { legend: { display: false }, annotation: { annotations: stageAnnotations() } },
    scales: { x: xGames(''), y: yAxis('') }
  }
});

/* ─── Transitions ────────────────────────── */
new Chart(document.getElementById('trainTrans'), {
  type: 'line',
  data: {
    labels: logGames,
    datasets: [{ data: logTransitions, borderColor: '#3663a1', backgroundColor: 'rgba(54,99,161,0.05)',
      fill: true, tension: 0.35, pointRadius: 0, borderWidth: 1.5 }]
  },
  options: {
    responsive: true, aspectRatio: 1.4,
    plugins: { legend: { display: false }, annotation: { annotations: stageAnnotations() } },
    scales: { x: xGames(''), y: yAxis('', { min: 0 }) }
  }
});
</script>
</body>
</html>`;

  const outPath = new URL('../data/dashboard.html', import.meta.url);
  writeFileSync(outPath, html);
  console.log(`Dashboard written to packages/ai/data/dashboard.html`);
  return outPath.pathname;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('generate-graphs.ts')) {
  generateDashboard();
}
