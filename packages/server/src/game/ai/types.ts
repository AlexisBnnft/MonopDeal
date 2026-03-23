import type {
  GameState, AnyCard, PendingAction, PropertyColor, AIDifficulty,
} from '@monopoly-deal/shared';

export interface PlayCardOpts {
  asMoney?: boolean;
  color?: PropertyColor;
  targetPlayerId?: string;
  targetCardId?: string;
  offeredCardId?: string;
  targetSetColor?: PropertyColor;
  doubleTheRentCardIds?: string[];
}

export type AIAction =
  | { type: 'play-card'; cardId: string; opts: PlayCardOpts }
  | { type: 'end-turn' };

export type AIResponse =
  | { accept: true; paymentCardIds: string[] }
  | { accept: false };

export interface AIStrategy {
  chooseAction(state: GameState, hand: AnyCard[], myId: string): AIAction | null;
  chooseResponse(state: GameState, hand: AnyCard[], myId: string, pending: PendingAction): AIResponse;
  chooseDiscard(hand: AnyCard[]): string[];
}

export type { AIDifficulty };
