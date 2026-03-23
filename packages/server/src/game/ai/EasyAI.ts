import type { GameState, AnyCard, PendingAction, WildcardCard } from '@monopoly-deal/shared';
import type { AIStrategy, AIAction, AIResponse } from './types.js';

/**
 * Naive bot: plays properties, banks everything else.
 * Mirrors the logic of the original test-bots.mjs script.
 */
export class EasyAI implements AIStrategy {

  chooseAction(state: GameState, hand: AnyCard[], myId: string): AIAction | null {
    if (hand.length === 0) return { type: 'end-turn' };

    for (const card of hand) {
      if (card.type === 'property') {
        return { type: 'play-card', cardId: card.id, opts: {} };
      }

      if (card.type === 'property_wildcard') {
        const wc = card as WildcardCard;
        const color = wc.colors === 'all' ? 'brown' : wc.colors[0];
        return { type: 'play-card', cardId: card.id, opts: { color } };
      }

      if (card.type === 'money') {
        return { type: 'play-card', cardId: card.id, opts: { asMoney: true } };
      }

      if (card.type === 'action' && card.actionType === 'pass_go') {
        return { type: 'play-card', cardId: card.id, opts: {} };
      }

      if (card.type === 'action' && card.actionType === 'its_my_birthday') {
        return { type: 'play-card', cardId: card.id, opts: {} };
      }

      // Bank all other action/rent cards as money
      if (card.type === 'action' || card.type === 'rent') {
        return { type: 'play-card', cardId: card.id, opts: { asMoney: true } };
      }
    }

    return { type: 'end-turn' };
  }

  chooseResponse(_state: GameState, _hand: AnyCard[], myId: string, pending: PendingAction): AIResponse {
    const me = _state.players.find(p => p.id === myId);
    if (!me) return { accept: true, paymentCardIds: [] };

    const payableIds = [
      ...me.bank.map(c => c.id),
      ...me.propertySets.flatMap(s =>
        s.cards.filter(c => !(c.type === 'property_wildcard' && (c as WildcardCard).colors === 'all'))
          .map(c => c.id)
      ),
    ];

    if (pending.type === 'deal_breaker' || pending.type === 'sly_deal' || pending.type === 'forced_deal') {
      return { accept: true, paymentCardIds: [] };
    }

    const amount = pending.amount ?? 0;
    const selected = selectPayment(payableIds, me, amount);
    return { accept: true, paymentCardIds: selected };
  }

  chooseDiscard(hand: AnyCard[]): string[] {
    const sorted = [...hand].sort((a, b) => a.value - b.value);
    return sorted.slice(0, hand.length - 7).map(c => c.id);
  }
}

function selectPayment(
  payableIds: string[],
  me: { bank: AnyCard[]; propertySets: { cards: AnyCard[] }[] },
  amount: number,
): string[] {
  if (payableIds.length === 0) return [];
  const allCards = [...me.bank, ...me.propertySets.flatMap(s => s.cards)];
  const sorted = payableIds
    .map(id => allCards.find(c => c.id === id)!)
    .filter(Boolean)
    .sort((a, b) => a.value - b.value);

  const selected: string[] = [];
  let total = 0;
  for (const card of sorted) {
    if (total >= amount) break;
    selected.push(card.id);
    total += card.value;
  }
  if (selected.length === 0 && payableIds.length > 0) {
    selected.push(payableIds[0]);
  }
  return selected;
}
