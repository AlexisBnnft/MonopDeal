import {
  SET_SIZE, RENT_VALUES,
  type GameState, type AnyCard, type PendingAction,
  type PropertyColor, type Player, type WildcardCard,
} from '@monopoly-deal/shared';
import type { AIStrategy, AIAction, AIResponse } from './types.js';

/**
 * Defensive/hoarder bot: keeps hand near 7, only plays when it has a clear advantage.
 * Saves action cards for the right moment, prioritises set completion over spending,
 * ends turn early to keep cards for later. Uses JSN liberally.
 */
export class HoarderAI implements AIStrategy {

  chooseAction(state: GameState, hand: AnyCard[], myId: string): AIAction | null {
    if (hand.length === 0) return { type: 'end-turn' };

    const me = state.players.find(p => p.id === myId)!;
    const opponents = state.players.filter(p => p.id !== myId);
    const actionsUsed = 3 - state.actionsRemaining;

    // Core philosophy: only play if the card is high-impact, otherwise hoard.
    // End turn early to keep hand size near 7 (max hand at end of turn).

    // 1. Always play properties that complete or nearly complete a set
    const propAction = this.pickHighImpactProperty(hand, me);
    if (propAction) return propAction;

    // 2. Deal Breaker is always worth playing
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

    // 3. If hand is already at 7, we need to play something or we'll discard
    const willDiscard = hand.length - actionsUsed > 7;

    // 4. High-value rent only (>= 3) — don't waste rent for small amounts
    const rentAction = this.pickHighValueRent(hand, me, opponents, state.actionsRemaining);
    if (rentAction) return rentAction;

    // 5. If we won't be forced to discard, end turn to hoard cards
    if (!willDiscard && actionsUsed >= 1) return { type: 'end-turn' };

    // 6. Play Pass Go to draw more cards (good for hoarding)
    const passGo = hand.find(c => c.type === 'action' && c.actionType === 'pass_go');
    if (passGo) return { type: 'play-card', cardId: passGo.id, opts: {} };

    // 7. Sly Deal only for cards that complete a set
    const slyDeal = hand.find(c => c.type === 'action' && c.actionType === 'sly_deal');
    if (slyDeal) {
      const target = this.findSetCompletingSteal(me, opponents);
      if (target) {
        return {
          type: 'play-card', cardId: slyDeal.id,
          opts: { targetPlayerId: target.playerId, targetCardId: target.cardId },
        };
      }
    }

    // 8. Play any property (even non-optimal) to avoid discarding
    if (willDiscard) {
      const anyProp = this.pickAnyProperty(hand, me);
      if (anyProp) return anyProp;
    }

    // 9. Bank money if we'd discard it anyway
    if (willDiscard) {
      const moneyCard = hand.find(c => c.type === 'money');
      if (moneyCard) return { type: 'play-card', cardId: moneyCard.id, opts: { asMoney: true } };

      // Bank low-value action cards to avoid discard
      for (const card of hand) {
        if (card.type === 'action' && card.actionType === 'just_say_no') continue;
        if (card.type === 'action' && card.actionType === 'deal_breaker') continue;
        if (card.type === 'action' && card.actionType === 'double_the_rent') continue;
        if (card.type === 'action' && card.actionType === 'sly_deal') continue;
        if (card.type === 'action' || card.type === 'rent') {
          return { type: 'play-card', cardId: card.id, opts: { asMoney: true } };
        }
      }
    }

    // 10. House/Hotel on complete sets
    const houseHotel = this.pickHouseHotel(hand, me);
    if (houseHotel) return houseHotel;

    // 11. It's My Birthday (low priority for hoarder — telegraphs weakness)
    const birthday = hand.find(c => c.type === 'action' && c.actionType === 'its_my_birthday');
    if (birthday && willDiscard) return { type: 'play-card', cardId: birthday.id, opts: {} };

    // 12. Debt Collector (only if we'd discard anyway or richest opponent is very rich)
    const debtCollector = hand.find(c => c.type === 'action' && c.actionType === 'debt_collector');
    if (debtCollector) {
      const richest = [...opponents].sort((a, b) => playerValue(b) - playerValue(a))[0];
      if (richest && (willDiscard || playerValue(richest) >= 5)) {
        return { type: 'play-card', cardId: debtCollector.id, opts: { targetPlayerId: richest.id } };
      }
    }

    return { type: 'end-turn' };
  }

  chooseResponse(state: GameState, hand: AnyCard[], myId: string, pending: PendingAction): AIResponse {
    const me = state.players.find(p => p.id === myId);
    if (!me) return { accept: true, paymentCardIds: [] };

    // Hoarder uses JSN very liberally — protect assets at all costs
    const hasJSN = hand.some(c => c.type === 'action' && c.actionType === 'just_say_no');
    if (hasJSN) {
      if (pending.type === 'deal_breaker') return { accept: false };
      if (pending.type === 'sly_deal') return { accept: false };
      if (pending.type === 'forced_deal') return { accept: false };
      // Block rent >= 3 or any monetary action when we have valuable board
      const myValue = playerValue(me);
      if (myValue >= 8 && (pending.amount ?? 0) >= 3) return { accept: false };
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
    // Hoarder: keep high-value action cards, discard money first
    const scored = hand.map(c => ({ card: c, score: hoarderDiscardScore(c) }));
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, excess).map(s => s.card.id);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private pickHighImpactProperty(hand: AnyCard[], me: Player): AIAction | null {
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
        const progress = (current + 1) / needed;
        // Only play if it gets us to >= 50% completion or completes the set
        if (progress >= 0.5) {
          if (progress > bestScore) { bestScore = progress; bestCard = card; }
        }
      } else {
        const wc = card as WildcardCard;
        const colors = wc.colors === 'all' ? allPropertyColors() : wc.colors;
        for (const color of colors) {
          const set = me.propertySets.find(s => s.color === color && !s.isComplete);
          const current = set ? set.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length : 0;
          const progress = (current + 1) / SET_SIZE[color];
          if (progress >= 0.5) {
            if (progress > bestScore) { bestScore = progress; bestCard = card; bestColor = color; }
          }
        }
      }
    }

    if (!bestCard) return null;
    if (bestCard.type === 'property') return { type: 'play-card', cardId: bestCard.id, opts: {} };
    const color = bestColor ?? ((bestCard as WildcardCard).colors === 'all' ? 'brown' : (bestCard as WildcardCard).colors[0]);
    return { type: 'play-card', cardId: bestCard.id, opts: { color } };
  }

  private pickAnyProperty(hand: AnyCard[], me: Player): AIAction | null {
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

  private pickHighValueRent(hand: AnyCard[], me: Player, opponents: Player[], actionsRemaining: number): AIAction | null {
    const rentCards = hand.filter(c => c.type === 'rent');
    if (rentCards.length === 0) return null;
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

    // Only charge rent >= 3 (hoarder is patient)
    if (!bestRent || bestAmount < 3) return null;

    const opts: Record<string, unknown> = { color: bestColor };
    if (bestRent.type === 'rent' && (bestRent as AnyCard & { colors: unknown }).colors === 'all') {
      const richest = [...opponents].sort((a, b) => playerValue(b) - playerValue(a))[0];
      opts.targetPlayerId = richest.id;
    }

    const dtr = hand.find(c => c.type === 'action' && c.actionType === 'double_the_rent');
    if (dtr && actionsRemaining >= 2) opts.doubleTheRentCardIds = [dtr.id];

    return { type: 'play-card', cardId: bestRent.id, opts };
  }

  private findSetCompletingSteal(me: Player, opponents: Player[]): { playerId: string; cardId: string } | null {
    // Only steal cards that complete one of our sets
    for (const opp of opponents) {
      for (const set of opp.propertySets) {
        if (set.isComplete) continue;
        for (const card of set.cards) {
          if (card.type !== 'property' && card.type !== 'property_wildcard') continue;
          const color = card.type === 'property' ? card.color : (card as WildcardCard).currentColor;
          if (!color) continue;
          const mySet = me.propertySets.find(s => s.color === color && !s.isComplete);
          if (!mySet) continue;
          const myProgress = mySet.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length;
          // Only steal if it completes the set
          if (myProgress + 1 >= SET_SIZE[color]) {
            return { playerId: opp.id, cardId: card.id };
          }
        }
      }
    }
    return null;
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

function hoarderDiscardScore(card: AnyCard): number {
  // Low score = discard first. Keep action cards and properties, discard money.
  if (card.type === 'money') return card.value;
  if (card.type === 'action' && card.actionType === 'just_say_no') return 100;
  if (card.type === 'action' && card.actionType === 'deal_breaker') return 95;
  if (card.type === 'action' && card.actionType === 'double_the_rent') return 90;
  if (card.type === 'action' && card.actionType === 'sly_deal') return 85;
  if (card.type === 'property') return 60;
  if (card.type === 'property_wildcard') return 55;
  if (card.type === 'rent') return 70;
  return card.value + 10;
}

function smartPayment(me: Player, amount: number): string[] {
  // Hoarder pays with bank first, strongly avoids breaking sets
  const bankCards = [...me.bank].sort((a, b) => a.value - b.value);
  const selected: string[] = [];
  let total = 0;

  // Try bank only first
  for (const card of bankCards) {
    if (total >= amount) break;
    selected.push(card.id);
    total += card.value;
  }
  if (total >= amount) return selected;

  // Only then dip into non-complete properties
  const propCards: AnyCard[] = [];
  for (const set of me.propertySets) {
    if (set.isComplete) continue;
    for (const c of set.cards) {
      if (c.type === 'property_wildcard' && (c as WildcardCard).colors === 'all') continue;
      if (c.type === 'property' || c.type === 'property_wildcard') propCards.push(c);
    }
  }
  propCards.sort((a, b) => a.value - b.value);
  for (const card of propCards) {
    if (total >= amount) break;
    selected.push(card.id);
    total += card.value;
  }
  if (total >= amount) return selected;

  // Last resort: complete set cards
  for (const set of me.propertySets) {
    if (!set.isComplete) continue;
    for (const c of set.cards) {
      if (total >= amount) break;
      if (c.type === 'property_wildcard' && (c as WildcardCard).colors === 'all') continue;
      if (!selected.includes(c.id)) { selected.push(c.id); total += c.value; }
    }
  }

  if (selected.length === 0 && me.bank.length > 0) selected.push(me.bank[0].id);
  return selected;
}
