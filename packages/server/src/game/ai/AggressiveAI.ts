import {
  SET_SIZE, RENT_VALUES,
  type GameState, type AnyCard, type PendingAction,
  type PropertyColor, type Player, type WildcardCard,
} from '@monopoly-deal/shared';
import type { AIStrategy, AIAction, AIResponse } from './types.js';

/**
 * Aggressive heuristic bot: uses all 3 actions every turn, banks aggressively,
 * charges rent early and often, targets richest opponents with action cards.
 * Prioritises money generation and spending all actions over set completion.
 */
export class AggressiveAI implements AIStrategy {

  chooseAction(state: GameState, hand: AnyCard[], myId: string): AIAction | null {
    if (hand.length === 0) return { type: 'end-turn' };

    const me = state.players.find(p => p.id === myId)!;
    const opponents = state.players.filter(p => p.id !== myId);

    // 1. Play Pass Go first — draw more cards to play more
    const passGo = hand.find(c => c.type === 'action' && c.actionType === 'pass_go');
    if (passGo) return { type: 'play-card', cardId: passGo.id, opts: {} };

    // 2. Charge rent on best set (even small amounts — always extract value)
    const rentAction = this.pickRent(hand, me, opponents, state.actionsRemaining);
    if (rentAction) return rentAction;

    // 3. Debt Collector on richest opponent
    const debtCollector = hand.find(c => c.type === 'action' && c.actionType === 'debt_collector');
    if (debtCollector) {
      const richest = [...opponents].sort((a, b) => playerValue(b) - playerValue(a))[0];
      if (richest && playerValue(richest) > 0) {
        return { type: 'play-card', cardId: debtCollector.id, opts: { targetPlayerId: richest.id } };
      }
    }

    // 4. It's My Birthday
    const birthday = hand.find(c => c.type === 'action' && c.actionType === 'its_my_birthday');
    if (birthday) return { type: 'play-card', cardId: birthday.id, opts: {} };

    // 5. Deal Breaker if available
    const dealBreaker = hand.find(c => c.type === 'action' && c.actionType === 'deal_breaker');
    if (dealBreaker) {
      for (const opp of opponents) {
        const completeSet = opp.propertySets.find(s => s.isComplete);
        if (completeSet) {
          return {
            type: 'play-card', cardId: dealBreaker.id,
            opts: { targetPlayerId: opp.id, targetSetColor: completeSet.color },
          };
        }
      }
    }

    // 6. Sly Deal — steal anything useful
    const slyDeal = hand.find(c => c.type === 'action' && c.actionType === 'sly_deal');
    if (slyDeal) {
      const target = this.findStealTarget(opponents);
      if (target) {
        return {
          type: 'play-card', cardId: slyDeal.id,
          opts: { targetPlayerId: target.playerId, targetCardId: target.cardId },
        };
      }
    }

    // 7. Play properties
    const propAction = this.pickProperty(hand, me);
    if (propAction) return propAction;

    // 8. Bank everything — never end turn with unused actions if we have cards
    const moneyCard = hand.find(c => c.type === 'money');
    if (moneyCard) return { type: 'play-card', cardId: moneyCard.id, opts: { asMoney: true } };

    // 9. Bank action/rent cards as money (keep JSN)
    for (const card of hand) {
      if (card.type === 'action' && card.actionType === 'just_say_no') continue;
      if (card.type === 'action' && card.actionType === 'double_the_rent') continue;
      if (card.type === 'action' || card.type === 'rent') {
        return { type: 'play-card', cardId: card.id, opts: { asMoney: true } };
      }
    }

    // 10. House/Hotel
    const houseHotel = this.pickHouseHotel(hand, me);
    if (houseHotel) return houseHotel;

    return { type: 'end-turn' };
  }

  chooseResponse(state: GameState, hand: AnyCard[], myId: string, pending: PendingAction): AIResponse {
    const me = state.players.find(p => p.id === myId);
    if (!me) return { accept: true, paymentCardIds: [] };

    // Aggressive: only use JSN to protect complete sets or against large rent (>= 5)
    const hasJSN = hand.some(c => c.type === 'action' && c.actionType === 'just_say_no');
    if (hasJSN) {
      if (pending.type === 'deal_breaker') return { accept: false };
      if (pending.type === 'rent' && (pending.amount ?? 0) >= 5) return { accept: false };
    }

    if (pending.type === 'deal_breaker' || pending.type === 'sly_deal' || pending.type === 'forced_deal') {
      return { accept: true, paymentCardIds: [] };
    }

    const amount = pending.amount ?? 0;
    return { accept: true, paymentCardIds: smartPayment(me, amount) };
  }

  chooseDiscard(hand: AnyCard[]): string[] {
    const excess = hand.length - 7;
    if (excess <= 0) return [];
    // Aggressive: discard low-value money and properties, keep action cards
    const scored = hand.map(c => ({ card: c, score: aggressiveDiscardScore(c) }));
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, excess).map(s => s.card.id);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private pickRent(hand: AnyCard[], me: Player, opponents: Player[], actionsRemaining: number): AIAction | null {
    const rentCards = hand.filter(c => c.type === 'rent');
    if (rentCards.length === 0) return null;
    // Aggressive: charge rent even for small amounts (threshold 1, not 2)
    if (opponents.every(p => playerValue(p) === 0)) return null;

    let bestRent: AnyCard | null = null;
    let bestColor: PropertyColor | undefined;
    let bestAmount = 0;

    for (const card of rentCards) {
      if (card.type !== 'rent') continue;
      const colors = card.colors === 'all'
        ? allPropertyColors()
        : card.colors as PropertyColor[];

      for (const color of colors) {
        const set = me.propertySets.find(s => s.color === color);
        if (!set || set.cards.length === 0) continue;
        const propCount = set.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length;
        const rentIdx = Math.min(propCount, RENT_VALUES[color].length) - 1;
        let amount = RENT_VALUES[color][rentIdx] || 0;
        if (set.hasHouse) amount += 3;
        if (set.hasHotel) amount += 4;
        if (amount > bestAmount) { bestAmount = amount; bestRent = card; bestColor = color; }
      }
    }

    if (!bestRent || bestAmount < 1) return null;

    const opts: Record<string, unknown> = { color: bestColor };
    if (bestRent.type === 'rent' && (bestRent as AnyCard & { colors: unknown }).colors === 'all') {
      const richest = [...opponents].sort((a, b) => playerValue(b) - playerValue(a))[0];
      opts.targetPlayerId = richest.id;
    }

    const dtr = hand.find(c => c.type === 'action' && c.actionType === 'double_the_rent');
    if (dtr && actionsRemaining >= 2) opts.doubleTheRentCardIds = [dtr.id];

    return { type: 'play-card', cardId: bestRent.id, opts };
  }

  private pickProperty(hand: AnyCard[], me: Player): AIAction | null {
    const properties = hand.filter(c => c.type === 'property' || c.type === 'property_wildcard');
    if (properties.length === 0) return null;

    let bestCard: AnyCard | null = null;
    let bestScore = -1;
    let bestColor: PropertyColor | undefined;

    for (const card of properties) {
      if (card.type === 'property') {
        const set = me.propertySets.find(s => s.color === card.color && !s.isComplete);
        const current = set ? set.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length : 0;
        const score = (current + 1) / SET_SIZE[card.color];
        if (score > bestScore) { bestScore = score; bestCard = card; }
      } else {
        const wc = card as WildcardCard;
        const colors = wc.colors === 'all' ? allPropertyColors() : wc.colors;
        for (const color of colors) {
          const set = me.propertySets.find(s => s.color === color && !s.isComplete);
          const current = set ? set.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length : 0;
          const score = (current + 1) / SET_SIZE[color];
          if (score > bestScore) { bestScore = score; bestCard = card; bestColor = color; }
        }
      }
    }

    if (!bestCard) return null;
    if (bestCard.type === 'property') return { type: 'play-card', cardId: bestCard.id, opts: {} };
    const color = bestColor ?? ((bestCard as WildcardCard).colors === 'all' ? 'brown' : (bestCard as WildcardCard).colors[0]);
    return { type: 'play-card', cardId: bestCard.id, opts: { color } };
  }

  private findStealTarget(opponents: Player[]): { playerId: string; cardId: string } | null {
    // Steal highest-value non-complete property
    let best: { playerId: string; cardId: string } | null = null;
    let bestValue = -1;
    for (const opp of opponents) {
      for (const set of opp.propertySets) {
        if (set.isComplete) continue;
        for (const c of set.cards) {
          if (c.type !== 'property' && c.type !== 'property_wildcard') continue;
          if (c.value > bestValue) { bestValue = c.value; best = { playerId: opp.id, cardId: c.id }; }
        }
      }
    }
    return best;
  }

  private pickHouseHotel(hand: AnyCard[], me: Player): AIAction | null {
    const house = hand.find(c => c.type === 'action' && c.actionType === 'house');
    if (house) {
      const eligible = me.propertySets.find(
        s => s.isComplete && !s.hasHouse && s.color !== 'railroad' && s.color !== 'utility',
      );
      if (eligible) return { type: 'play-card', cardId: house.id, opts: { color: eligible.color } };
    }
    const hotel = hand.find(c => c.type === 'action' && c.actionType === 'hotel');
    if (hotel) {
      const eligible = me.propertySets.find(
        s => s.isComplete && s.hasHouse && !s.hasHotel && s.color !== 'railroad' && s.color !== 'utility',
      );
      if (eligible) return { type: 'play-card', cardId: hotel.id, opts: { color: eligible.color } };
    }
    return null;
  }
}

// ─── Utility Functions ───────────────────────────────────────────────────────

function playerValue(p: Player): number {
  let total = 0;
  for (const c of p.bank) total += c.value;
  for (const s of p.propertySets) {
    for (const c of s.cards) {
      if (c.type === 'property_wildcard' && (c as WildcardCard).colors === 'all') continue;
      total += c.value;
    }
  }
  return total;
}

function allPropertyColors(): PropertyColor[] {
  return ['brown', 'blue', 'green', 'light_blue', 'orange', 'pink', 'railroad', 'red', 'yellow', 'utility'];
}

function aggressiveDiscardScore(card: AnyCard): number {
  // Low score = discard first. Keep action cards, discard low money.
  if (card.type === 'money' && card.value <= 2) return 5;
  if (card.type === 'money') return card.value + 10;
  if (card.type === 'property') return 40;
  if (card.type === 'property_wildcard') return 50;
  if (card.type === 'action' && card.actionType === 'just_say_no') return 100;
  if (card.type === 'action' && card.actionType === 'deal_breaker') return 90;
  if (card.type === 'action' && card.actionType === 'debt_collector') return 80;
  if (card.type === 'rent') return 70;
  return 30;
}

function smartPayment(me: Player, amount: number): string[] {
  const bankCards = [...me.bank].sort((a, b) => a.value - b.value);
  const propCards: AnyCard[] = [];
  for (const set of me.propertySets) {
    if (set.isComplete) continue;
    for (const c of set.cards) {
      if (c.type === 'property_wildcard' && (c as WildcardCard).colors === 'all') continue;
      if (c.type === 'property' || c.type === 'property_wildcard') propCards.push(c);
    }
  }
  propCards.sort((a, b) => a.value - b.value);

  const all = [...bankCards, ...propCards];
  const selected: string[] = [];
  let total = 0;
  for (const card of all) {
    if (total >= amount) break;
    selected.push(card.id);
    total += card.value;
  }

  if (total < amount) {
    for (const set of me.propertySets) {
      if (!set.isComplete) continue;
      for (const c of set.cards) {
        if (total >= amount) break;
        if (c.type === 'property_wildcard' && (c as WildcardCard).colors === 'all') continue;
        if (!selected.includes(c.id)) { selected.push(c.id); total += c.value; }
      }
    }
  }

  if (selected.length === 0 && me.bank.length > 0) selected.push(me.bank[0].id);
  return selected;
}
