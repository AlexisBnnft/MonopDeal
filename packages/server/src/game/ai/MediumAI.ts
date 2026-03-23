import {
  SET_SIZE, RENT_VALUES,
  type GameState, type AnyCard, type PendingAction,
  type PropertyColor, type Player, type PropertySet, type WildcardCard,
} from '@monopoly-deal/shared';
import type { AIStrategy, AIAction, AIResponse } from './types.js';

/**
 * Heuristic bot: prioritises completing sets, plays rent on best sets,
 * uses action cards strategically, protects complete sets with JSN.
 */
export class MediumAI implements AIStrategy {

  chooseAction(state: GameState, hand: AnyCard[], myId: string): AIAction | null {
    if (hand.length === 0) return { type: 'end-turn' };

    const me = state.players.find(p => p.id === myId)!;
    const opponents = state.players.filter(p => p.id !== myId);

    // 1. Play properties that advance towards completing a set
    const propAction = this.pickBestProperty(hand, me);
    if (propAction) return propAction;

    // 2. Play Deal Breaker if opponent has a complete set
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

    // 3. Play rent on our best set
    const rentAction = this.pickBestRent(hand, me, opponents, state.actionsRemaining);
    if (rentAction) return rentAction;

    // 4. Play Sly Deal to steal a property we need
    const slyDeal = hand.find(c => c.type === 'action' && c.actionType === 'sly_deal');
    if (slyDeal) {
      const steal = this.findSlyDealTarget(me, opponents);
      if (steal) {
        return {
          type: 'play-card', cardId: slyDeal.id,
          opts: { targetPlayerId: steal.playerId, targetCardId: steal.cardId },
        };
      }
    }

    // 5. Play Debt Collector on richest opponent
    const debtCollector = hand.find(c => c.type === 'action' && c.actionType === 'debt_collector');
    if (debtCollector) {
      const richest = [...opponents].sort((a, b) => playerValue(b) - playerValue(a))[0];
      if (richest && playerValue(richest) > 0) {
        return {
          type: 'play-card', cardId: debtCollector.id,
          opts: { targetPlayerId: richest.id },
        };
      }
    }

    // 6. Play It's My Birthday
    const birthday = hand.find(c => c.type === 'action' && c.actionType === 'its_my_birthday');
    if (birthday) return { type: 'play-card', cardId: birthday.id, opts: {} };

    // 7. Play Pass Go
    const passGo = hand.find(c => c.type === 'action' && c.actionType === 'pass_go');
    if (passGo) return { type: 'play-card', cardId: passGo.id, opts: {} };

    // 8. Play House/Hotel on complete sets
    const houseHotel = this.pickHouseHotel(hand, me);
    if (houseHotel) return houseHotel;

    // 9. Bank money cards
    const moneyCard = hand.find(c => c.type === 'money');
    if (moneyCard) return { type: 'play-card', cardId: moneyCard.id, opts: { asMoney: true } };

    // 10. Bank remaining action/rent cards as money (but keep JSN)
    for (const card of hand) {
      if (card.type === 'action' && card.actionType === 'just_say_no') continue;
      if (card.type === 'action' && card.actionType === 'double_the_rent') continue;
      if (card.type === 'action' || card.type === 'rent') {
        return { type: 'play-card', cardId: card.id, opts: { asMoney: true } };
      }
    }

    return { type: 'end-turn' };
  }

  chooseResponse(state: GameState, hand: AnyCard[], myId: string, pending: PendingAction): AIResponse {
    const me = state.players.find(p => p.id === myId);
    if (!me) return { accept: true, paymentCardIds: [] };

    // Use JSN to protect complete sets from Deal Breaker / Sly Deal
    const hasJSN = hand.some(c => c.type === 'action' && c.actionType === 'just_say_no');
    if (hasJSN) {
      const shouldBlock =
        pending.type === 'deal_breaker' ||
        (pending.type === 'sly_deal' && me.propertySets.some(s => s.cards.length >= SET_SIZE[s.color] - 1));
      if (shouldBlock) return { accept: false };
    }

    if (pending.type === 'deal_breaker' || pending.type === 'sly_deal' || pending.type === 'forced_deal') {
      return { accept: true, paymentCardIds: [] };
    }

    const amount = pending.amount ?? 0;
    const selected = smartPayment(me, amount);
    return { accept: true, paymentCardIds: selected };
  }

  chooseDiscard(hand: AnyCard[]): string[] {
    const excess = hand.length - 7;
    if (excess <= 0) return [];

    const scored = hand.map(c => ({ card: c, score: discardScore(c) }));
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, excess).map(s => s.card.id);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private pickBestProperty(hand: AnyCard[], me: Player): AIAction | null {
    const properties = hand.filter(c => c.type === 'property' || c.type === 'property_wildcard');
    if (properties.length === 0) return null;

    let bestCard: AnyCard | null = null;
    let bestScore = -1;
    let bestColor: PropertyColor | undefined;

    for (const card of properties) {
      if (card.type === 'property') {
        const set = me.propertySets.find(s => s.color === card.color && !s.isComplete);
        const current = set ? set.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length : 0;
        const needed = SET_SIZE[card.color];
        const score = (current + 1) / needed;
        if (score > bestScore) { bestScore = score; bestCard = card; }
      } else {
        const wc = card as WildcardCard;
        const colors = wc.colors === 'all' ? allPropertyColors() : wc.colors;
        for (const color of colors) {
          const set = me.propertySets.find(s => s.color === color && !s.isComplete);
          const current = set ? set.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length : 0;
          const needed = SET_SIZE[color];
          const score = (current + 1) / needed;
          if (score > bestScore) { bestScore = score; bestCard = card; bestColor = color; }
        }
      }
    }

    if (!bestCard) return null;

    if (bestCard.type === 'property') {
      return { type: 'play-card', cardId: bestCard.id, opts: {} };
    }
    const wc = bestCard as WildcardCard;
    const color = bestColor ?? (wc.colors === 'all' ? 'brown' : wc.colors[0]);
    return { type: 'play-card', cardId: bestCard.id, opts: { color } };
  }

  private pickBestRent(hand: AnyCard[], me: Player, opponents: Player[], actionsRemaining: number): AIAction | null {
    const rentCards = hand.filter(c => c.type === 'rent');
    if (rentCards.length === 0) return null;
    if (opponents.every(p => playerValue(p) === 0)) return null;

    let bestRent: AnyCard | null = null;
    let bestColor: PropertyColor | undefined;
    let bestAmount = 0;

    for (const card of rentCards) {
      if (card.type !== 'rent') continue;
      const rentCard = card as AnyCard & { colors: [PropertyColor, PropertyColor] | 'all' };
      const colors = rentCard.colors === 'all' ? allPropertyColors() : rentCard.colors;

      for (const color of colors) {
        const set = me.propertySets.find(s => s.color === color);
        if (!set || set.cards.length === 0) continue;
        const propCount = set.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length;
        const rentIdx = Math.min(propCount, RENT_VALUES[color].length) - 1;
        let amount = RENT_VALUES[color][rentIdx] || 0;
        if (set.hasHouse) amount += 3;
        if (set.hasHotel) amount += 4;

        if (amount > bestAmount) {
          bestAmount = amount;
          bestRent = card;
          bestColor = color;
        }
      }
    }

    if (!bestRent || bestAmount < 2) return null;

    const opts: Record<string, unknown> = { color: bestColor };
    // For wild rent, target the richest opponent
    if (bestRent.type === 'rent') {
      const rc = bestRent as AnyCard & { colors: [PropertyColor, PropertyColor] | 'all' };
      if (rc.colors === 'all') {
        const richest = [...opponents].sort((a, b) => playerValue(b) - playerValue(a))[0];
        opts.targetPlayerId = richest.id;
      }
    }

    // Stack Double the Rent if available and we have enough actions (rent=1 + DTR=1 = 2)
    const dtr = hand.find(c => c.type === 'action' && c.actionType === 'double_the_rent');
    if (dtr && actionsRemaining >= 2) opts.doubleTheRentCardIds = [dtr.id];

    return { type: 'play-card', cardId: bestRent.id, opts };
  }

  private findSlyDealTarget(me: Player, opponents: Player[]): { playerId: string; cardId: string } | null {
    const myColors = new Set(me.propertySets.map(s => s.color));

    for (const opp of opponents) {
      for (const set of opp.propertySets) {
        if (set.isComplete) continue;
        for (const card of set.cards) {
          if (card.type !== 'property' && card.type !== 'property_wildcard') continue;
          const color = card.type === 'property' ? card.color : (card as WildcardCard).currentColor;
          if (myColors.has(color)) {
            return { playerId: opp.id, cardId: card.id };
          }
        }
      }
    }

    // Steal any non-complete property
    for (const opp of opponents) {
      for (const set of opp.propertySets) {
        if (set.isComplete) continue;
        const propCard = set.cards.find(c => c.type === 'property' || c.type === 'property_wildcard');
        if (propCard) return { playerId: opp.id, cardId: propCard.id };
      }
    }

    return null;
  }

  private pickHouseHotel(hand: AnyCard[], me: Player): AIAction | null {
    const house = hand.find(c => c.type === 'action' && c.actionType === 'house');
    if (house) {
      const eligible = me.propertySets.find(
        s => s.isComplete && !s.hasHouse && s.color !== 'railroad' && s.color !== 'utility'
      );
      if (eligible) {
        return { type: 'play-card', cardId: house.id, opts: { color: eligible.color } };
      }
    }

    const hotel = hand.find(c => c.type === 'action' && c.actionType === 'hotel');
    if (hotel) {
      const eligible = me.propertySets.find(
        s => s.isComplete && s.hasHouse && !s.hasHotel && s.color !== 'railroad' && s.color !== 'utility'
      );
      if (eligible) {
        return { type: 'play-card', cardId: hotel.id, opts: { color: eligible.color } };
      }
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

function discardScore(card: AnyCard): number {
  if (card.type === 'money') return card.value;
  if (card.type === 'action' && card.actionType === 'just_say_no') return 100;
  if (card.type === 'action' && card.actionType === 'deal_breaker') return 80;
  if (card.type === 'property') return 60;
  if (card.type === 'property_wildcard') return 50;
  return card.value + 10;
}

/**
 * Pay with lowest-value cards from bank first, then non-complete properties.
 * Avoids breaking complete sets and paying with multicolor wildcards.
 */
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

  // If still not enough, dip into complete sets
  if (total < amount) {
    for (const set of me.propertySets) {
      if (!set.isComplete) continue;
      for (const c of set.cards) {
        if (total >= amount) break;
        if (c.type === 'property_wildcard' && (c as WildcardCard).colors === 'all') continue;
        if (!selected.includes(c.id)) {
          selected.push(c.id);
          total += c.value;
        }
      }
    }
  }

  if (selected.length === 0 && me.bank.length > 0) {
    selected.push(me.bank[0].id);
  }
  return selected;
}
