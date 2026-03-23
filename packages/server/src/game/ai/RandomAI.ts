import type { GameState, AnyCard, PendingAction, WildcardCard, PropertyColor } from '@monopoly-deal/shared';
import type { AIStrategy, AIAction, AIResponse } from './types.js';

const ALL_COLORS: PropertyColor[] = [
  'brown', 'blue', 'green', 'light_blue', 'orange', 'pink', 'railroad', 'red', 'yellow', 'utility',
];

/**
 * Completely random bot: picks a random legal action each time.
 * Used as the weakest Elo baseline (~800).
 */
export class RandomAI implements AIStrategy {

  chooseAction(_state: GameState, hand: AnyCard[], _myId: string): AIAction | null {
    if (hand.length === 0) return { type: 'end-turn' };

    // 30% chance to just end turn early
    if (Math.random() < 0.3) return { type: 'end-turn' };

    const card = hand[Math.floor(Math.random() * hand.length)];

    if (card.type === 'property') {
      return { type: 'play-card', cardId: card.id, opts: {} };
    }

    if (card.type === 'property_wildcard') {
      const wc = card as WildcardCard;
      const colors = wc.colors === 'all' ? ALL_COLORS : wc.colors;
      const color = colors[Math.floor(Math.random() * colors.length)];
      return { type: 'play-card', cardId: card.id, opts: { color } };
    }

    if (card.type === 'money') {
      return { type: 'play-card', cardId: card.id, opts: {} };
    }

    // Bank action/rent cards as money (safe random play)
    if (card.type === 'action' || card.type === 'rent') {
      if (card.type === 'action' && card.actionType === 'pass_go') {
        return { type: 'play-card', cardId: card.id, opts: {} };
      }
      return { type: 'play-card', cardId: card.id, opts: { asMoney: true } };
    }

    return { type: 'end-turn' };
  }

  chooseResponse(state: GameState, _hand: AnyCard[], myId: string, pending: PendingAction): AIResponse {
    const me = state.players.find(p => p.id === myId);
    if (!me) return { accept: true, paymentCardIds: [] };

    if (pending.type === 'deal_breaker' || pending.type === 'sly_deal' || pending.type === 'forced_deal') {
      return { accept: true, paymentCardIds: [] };
    }

    const payableIds = [
      ...me.bank.map(c => c.id),
      ...me.propertySets.flatMap(s =>
        s.cards.filter(c => !(c.type === 'property_wildcard' && (c as WildcardCard).colors === 'all'))
          .map(c => c.id)
      ),
    ];

    if (payableIds.length === 0) return { accept: true, paymentCardIds: [] };

    // Pick random subset up to amount
    const shuffled = payableIds.sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(3, shuffled.length));
    return { accept: true, paymentCardIds: selected };
  }

  chooseDiscard(hand: AnyCard[]): string[] {
    const excess = hand.length - 7;
    if (excess <= 0) return [];
    const shuffled = [...hand].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, excess).map(c => c.id);
  }
}
