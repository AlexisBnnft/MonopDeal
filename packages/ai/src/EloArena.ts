import { simulateGame, type AgentEntry, type GameResult } from './Simulator.js';
import type { AIStrategy } from '../../server/src/game/ai/types.js';

export interface EloPlayer {
  agentId: string;
  elo: number;
  gamesPlayed: number;
  wins: number;
  trainingStep?: number;
}

export interface MatchResult {
  player1: string;
  player2: string;
  winnerId: string | null;
  turns: number;
}

export interface ArenaReport {
  players: EloPlayer[];
  matchResults: MatchResult[];
  headToHead: Map<string, Map<string, { wins: number; losses: number; draws: number }>>;
}

const DEFAULT_ELO = 1000;
const K_NEW = 32;
const K_ESTABLISHED = 16;
const ESTABLISHED_THRESHOLD = 30;

function expectedScore(eloA: number, eloB: number): number {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

export class EloArena {
  private players = new Map<string, EloPlayer>();
  private strategies = new Map<string, AIStrategy>();
  private matchHistory: MatchResult[] = [];

  registerAgent(agentId: string, strategy: AIStrategy, initialElo = DEFAULT_ELO, trainingStep?: number): void {
    if (!this.players.has(agentId)) {
      this.players.set(agentId, {
        agentId,
        elo: initialElo,
        gamesPlayed: 0,
        wins: 0,
        trainingStep,
      });
    }
    this.strategies.set(agentId, strategy);
  }

  /**
   * Run a round-robin tournament: every agent plays against every other agent
   * M games per pair, in 2-player matches.
   */
  runRoundRobin(gamesPerPair = 100): ArenaReport {
    const agentIds = [...this.players.keys()];
    const results: MatchResult[] = [];
    const headToHead = new Map<string, Map<string, { wins: number; losses: number; draws: number }>>();

    for (const id of agentIds) {
      headToHead.set(id, new Map());
      for (const otherId of agentIds) {
        if (id !== otherId) {
          headToHead.get(id)!.set(otherId, { wins: 0, losses: 0, draws: 0 });
        }
      }
    }

    for (let i = 0; i < agentIds.length; i++) {
      for (let j = i + 1; j < agentIds.length; j++) {
        const id1 = agentIds[i];
        const id2 = agentIds[j];

        for (let g = 0; g < gamesPerPair; g++) {
          // Alternate who goes first
          const first = g % 2 === 0 ? id1 : id2;
          const second = first === id1 ? id2 : id1;

          const agents: AgentEntry[] = [
            { id: first, name: first, strategy: this.strategies.get(first)! },
            { id: second, name: second, strategy: this.strategies.get(second)! },
          ];

          const gameResult = simulateGame(agents);
          const winnerId = gameResult?.winnerId ?? null;

          results.push({ player1: first, player2: second, winnerId, turns: gameResult?.turns ?? 0 });

          // Update Elo
          this.updateElo(first, second, winnerId);

          // Update head-to-head
          if (winnerId === first) {
            headToHead.get(first)!.get(second)!.wins++;
            headToHead.get(second)!.get(first)!.losses++;
          } else if (winnerId === second) {
            headToHead.get(second)!.get(first)!.wins++;
            headToHead.get(first)!.get(second)!.losses++;
          } else {
            headToHead.get(first)!.get(second)!.draws++;
            headToHead.get(second)!.get(first)!.draws++;
          }
        }
      }
    }

    this.matchHistory.push(...results);

    return {
      players: this.getLeaderboard(),
      matchResults: results,
      headToHead,
    };
  }

  private updateElo(id1: string, id2: string, winnerId: string | null): void {
    const p1 = this.players.get(id1)!;
    const p2 = this.players.get(id2)!;

    const expected1 = expectedScore(p1.elo, p2.elo);
    const expected2 = expectedScore(p2.elo, p1.elo);

    let actual1: number, actual2: number;
    if (winnerId === id1) {
      actual1 = 1; actual2 = 0;
      p1.wins++;
    } else if (winnerId === id2) {
      actual1 = 0; actual2 = 1;
      p2.wins++;
    } else {
      actual1 = 0.5; actual2 = 0.5;
    }

    const k1 = p1.gamesPlayed < ESTABLISHED_THRESHOLD ? K_NEW : K_ESTABLISHED;
    const k2 = p2.gamesPlayed < ESTABLISHED_THRESHOLD ? K_NEW : K_ESTABLISHED;

    p1.elo += k1 * (actual1 - expected1);
    p2.elo += k2 * (actual2 - expected2);

    p1.gamesPlayed++;
    p2.gamesPlayed++;
  }

  getLeaderboard(): EloPlayer[] {
    return [...this.players.values()].sort((a, b) => b.elo - a.elo);
  }

  getPlayer(agentId: string): EloPlayer | undefined {
    return this.players.get(agentId);
  }

  getMatchHistory(): MatchResult[] {
    return this.matchHistory;
  }

  toJSON(): object {
    return {
      leaderboard: this.getLeaderboard(),
      totalGames: this.matchHistory.length,
    };
  }
}
