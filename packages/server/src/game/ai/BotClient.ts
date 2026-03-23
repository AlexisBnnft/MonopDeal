import { io, type Socket } from 'socket.io-client';
import type {
  GameState, AnyCard, PendingAction, WildcardCard,
  ClientEvents, ServerEvents,
} from '@monopoly-deal/shared';
import type { AIStrategy } from './types.js';

type BotSocket = Socket<ServerEvents, ClientEvents>;

const ACTION_DELAY_MIN = 600;
const ACTION_DELAY_MAX = 1500;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export class BotClient {
  private socket: BotSocket;
  private hand: AnyCard[] = [];
  private gameState: GameState | null = null;
  private playing = false;
  private stateUpdatedWhilePlaying = false;
  private connected = false;
  private fast: boolean;
  private consecutiveErrors = 0;

  private randomDelay(): Promise<void> {
    if (this.fast) return Promise.resolve();
    return sleep(ACTION_DELAY_MIN + Math.random() * (ACTION_DELAY_MAX - ACTION_DELAY_MIN));
  }

  private postActionDelay(): Promise<void> {
    return this.fast ? Promise.resolve() : sleep(800);
  }

  constructor(
    private name: string,
    serverUrl: string,
    private strategy: AIStrategy,
    fast = false,
  ) {
    this.fast = fast;
    this.socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: false,
    }) as unknown as BotSocket;

    this.socket.on('connect', () => { this.connected = true; });
    this.socket.on('disconnect', () => { this.connected = false; });
    this.socket.on('game:hand', (hand) => { this.hand = hand; });
    this.socket.on('game:state', (state) => {
      this.gameState = state;
      this.consecutiveErrors = 0;
      if (this.playing) {
        this.stateUpdatedWhilePlaying = true;
      } else {
        this.onStateUpdate();
      }
    });
    this.socket.on('game:notification', () => {});
    this.socket.on('error', (msg) => {
      this.consecutiveErrors++;
      if (this.consecutiveErrors <= 3) {
        console.log(`  [Bot ${this.name}] error: ${msg}`);
      }
      if (!this.playing && this.consecutiveErrors < 3) {
        this.onStateUpdate();
      } else if (!this.playing && this.gameState) {
        const cp = this.gameState.players[this.gameState.currentPlayerIndex];
        if (cp && cp.id === this.socket.id && this.gameState.turnPhase === 'action') {
          this.socket.emit('game:end-turn');
        }
      }
    });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Bot connect timeout')), 5000);
      this.socket.once('connect', () => { clearTimeout(timeout); resolve(); });
      this.socket.connect();
    });
  }

  async joinRoom(roomId: string): Promise<void> {
    this.socket.emit('room:join', { playerName: this.name, roomId });
    await sleep(200);
  }

  disconnect(): void {
    this.socket.disconnect();
  }

  getSocketId(): string | undefined {
    return this.socket.id ?? undefined;
  }

  private finishPlaying(): void {
    this.playing = false;
    if (this.stateUpdatedWhilePlaying) {
      this.stateUpdatedWhilePlaying = false;
      this.onStateUpdate();
    }
  }

  // Called whenever game state is updated
  private async onStateUpdate(): Promise<void> {
    if (this.playing || !this.gameState) return;
    if (this.gameState.phase === 'finished') return;

    const myId = this.socket.id;
    if (!myId) return;

    // Handle pending action responses (for any bot that is a target)
    if (this.gameState.pendingAction) {
      const pa = this.gameState.pendingAction;

      // Handle JSN chain counter
      if (pa.jsnChain && pa.jsnChain.awaitingCounterFrom === myId) {
        this.playing = true;
        await this.randomDelay();
        this.socket.emit('game:respond', { accept: false });
        await this.postActionDelay();
        this.finishPlaying();
        return;
      }

      if (pa.targetPlayerIds.includes(myId) && !pa.respondedPlayerIds.includes(myId)) {
        this.playing = true;
        await this.randomDelay();
        const response = this.strategy.chooseResponse(this.gameState, this.hand, myId, pa);
        this.socket.emit('game:respond', {
          accept: response.accept,
          paymentCardIds: response.accept ? response.paymentCardIds : undefined,
        });
        await this.postActionDelay();
        this.finishPlaying();
        return;
      }
    }

    // Check if it's our turn
    const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== myId) return;
    if (this.gameState.pendingAction) return;

    this.playing = true;

    try {
      const phase = this.gameState.turnPhase;

      if (phase === 'draw') {
        await this.randomDelay();
        this.socket.emit('game:draw');
        await this.postActionDelay();
        this.finishPlaying();
        return;
      }

      if (phase === 'discard') {
        await this.randomDelay();
        if (this.hand.length > 7) {
          const discardIds = this.strategy.chooseDiscard(this.hand);
          this.socket.emit('game:discard', { cardIds: discardIds });
        }
        this.finishPlaying();
        return;
      }

      if (phase === 'action') {
        if (this.gameState.actionsRemaining <= 0) {
          await this.randomDelay();
          this.socket.emit('game:end-turn');
          this.finishPlaying();
          return;
        }

        const me = this.gameState.players.find(p => p.id === myId);
        if (me && this.hand.length === 0 && me.handCount > 0) {
          // Hand not received yet; wait briefly then retry
          this.finishPlaying();
          return;
        }

        const action = this.strategy.chooseAction(this.gameState, this.hand, myId);
        if (!action || action.type === 'end-turn') {
          await this.randomDelay();
          this.socket.emit('game:end-turn');
          this.finishPlaying();
          return;
        }

        await this.randomDelay();
        this.socket.emit('game:play-card', {
          cardId: action.cardId,
          ...action.opts,
        });
        await this.postActionDelay();
        this.finishPlaying();
        return;
      }
    } catch (err) {
      console.error(`  [Bot ${this.name}] error in play loop:`, err);
    }

    this.finishPlaying();
  }
}
