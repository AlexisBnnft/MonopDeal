import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

export interface EloSnapshot {
  agentId: string;
  elo: number;
  winRate: number;
  gamesPlayed: number;
  trainingStep: number | null;
  timestamp: number;
}

export interface ProgressionEntry {
  round: number;
  timestamp: number;
  snapshots: EloSnapshot[];
}

const DATA_DIR = new URL('../data', import.meta.url);
const PROGRESSION_FILE = new URL('../data/elo-progression.json', import.meta.url);

/**
 * Tracks Elo progression over multiple evaluation rounds
 * and detects convergence.
 */
export class EloTracker {
  private progression: ProgressionEntry[] = [];

  constructor() {
    mkdirSync(DATA_DIR, { recursive: true });
    if (existsSync(PROGRESSION_FILE)) {
      try {
        this.progression = JSON.parse(readFileSync(PROGRESSION_FILE, 'utf-8'));
      } catch {
        this.progression = [];
      }
    }
  }

  recordRound(snapshots: EloSnapshot[]): void {
    this.progression.push({
      round: this.progression.length + 1,
      timestamp: Date.now(),
      snapshots,
    });
    this.save();
  }

  /**
   * Check if a specific agent's Elo has converged:
   * - Elo change < threshold over the last N rounds
   */
  hasConverged(agentId: string, rounds = 5, threshold = 15): boolean {
    if (this.progression.length < rounds) return false;

    const recent = this.progression.slice(-rounds);
    const elos = recent.map(entry => {
      const snap = entry.snapshots.find(s => s.agentId === agentId);
      return snap?.elo ?? null;
    }).filter((e): e is number => e !== null);

    if (elos.length < rounds) return false;

    const min = Math.min(...elos);
    const max = Math.max(...elos);
    return (max - min) < threshold;
  }

  /**
   * Check if an agent consistently beats a baseline at >winRateThreshold
   */
  consistentlyBeats(
    agentId: string,
    baselineId: string,
    winRateThreshold = 0.7,
    rounds = 3,
  ): boolean {
    if (this.progression.length < rounds) return false;

    const recent = this.progression.slice(-rounds);
    return recent.every(entry => {
      const snap = entry.snapshots.find(s => s.agentId === agentId);
      return snap && snap.winRate >= winRateThreshold;
    });
  }

  getProgression(): ProgressionEntry[] {
    return this.progression;
  }

  /**
   * Print a summary of Elo progression for all agents.
   */
  printProgression(): void {
    if (this.progression.length === 0) {
      console.log('No progression data recorded yet.');
      return;
    }

    const allAgents = new Set<string>();
    for (const entry of this.progression) {
      for (const snap of entry.snapshots) allAgents.add(snap.agentId);
    }

    console.log('\n--- Elo Progression ---\n');
    const agents = [...allAgents];
    const header = 'Round'.padEnd(8) + agents.map(a => a.padEnd(14)).join('');
    console.log(header);
    console.log('-'.repeat(header.length));

    for (const entry of this.progression) {
      let line = String(entry.round).padEnd(8);
      for (const agentId of agents) {
        const snap = entry.snapshots.find(s => s.agentId === agentId);
        line += snap ? String(Math.round(snap.elo)).padEnd(14) : 'N/A'.padEnd(14);
      }
      console.log(line);
    }
  }

  private save(): void {
    writeFileSync(PROGRESSION_FILE, JSON.stringify(this.progression, null, 2));
  }
}
