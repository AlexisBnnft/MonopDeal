import { BOT_NAMES, type AIDifficulty } from '@monopoly-deal/shared';
import { BotClient } from './BotClient.js';
import { EasyAI } from './EasyAI.js';
import { MediumAI } from './MediumAI.js';
import { HardAI } from './HardAI.js';
import type { AIStrategy } from './types.js';

function createStrategy(difficulty: AIDifficulty): AIStrategy {
  switch (difficulty) {
    case 'easy': return new EasyAI();
    case 'medium': return new MediumAI();
    case 'hard': return new HardAI();
  }
}

class BotManager {
  private bots = new Map<string, BotClient[]>();

  async spawnBots(
    roomId: string,
    count: number,
    difficulty: AIDifficulty,
    serverUrl: string,
    fast = false,
  ): Promise<void> {
    const botCount = Math.min(count, BOT_NAMES.length);
    const clients: BotClient[] = [];

    for (let i = 0; i < botCount; i++) {
      const name = `${BOT_NAMES[i]} (IA)`;
      const strategy = createStrategy(difficulty);
      const bot = new BotClient(name, serverUrl, strategy, fast);

      await bot.connect();
      await bot.joinRoom(roomId);
      clients.push(bot);
    }

    this.bots.set(roomId, clients);
    console.log(`[BotManager] Spawned ${botCount} ${difficulty} bot(s) in room ${roomId}`);
  }

  cleanupRoom(roomId: string): void {
    const clients = this.bots.get(roomId);
    if (!clients) return;
    for (const bot of clients) bot.disconnect();
    this.bots.delete(roomId);
    console.log(`[BotManager] Cleaned up bots for room ${roomId}`);
  }

  hasBotsInRoom(roomId: string): boolean {
    return this.bots.has(roomId);
  }
}

export const botManager = new BotManager();
