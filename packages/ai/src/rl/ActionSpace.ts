import {
  PROPERTY_COLORS, SET_SIZE, RENT_VALUES,
  type GameState, type AnyCard, type Player, type PropertyColor,
  type WildcardCard, type PendingAction,
} from '@monopoly-deal/shared';
import type { AIAction, PlayCardOpts } from '../../../server/src/game/ai/types.js';

export const MAX_ACTIONS = 95;

export interface ActionCandidate {
  index: number;
  action: AIAction | { type: 'respond-accept' } | { type: 'respond-reject' } | { type: 'discard'; cardId: string } | { type: 'pay'; cardId: string } | { type: 'finish-payment' } | { type: 'rearrange'; cardId: string; toColor: PropertyColor } | { type: 'skip-rearrange' };
}

// ─── Deterministic hand sorting ───────────────────────────────────────────

const TYPE_ORDER: Record<string, number> = {
  money: 0, property: 1, property_wildcard: 2, rent: 3, action: 4,
};
const ACTION_TYPE_ORDER: Record<string, number> = {
  pass_go: 0, deal_breaker: 1, sly_deal: 2, forced_deal: 3,
  debt_collector: 4, its_my_birthday: 5, house: 6, hotel: 7,
  just_say_no: 8, double_the_rent: 9,
};
const COLOR_ORDER: Record<string, number> = Object.fromEntries(
  PROPERTY_COLORS.map((c, i) => [c, i]),
);

function cardSortKey(card: AnyCard): number {
  const typeOrd = TYPE_ORDER[card.type] ?? 5;
  let sub = 0;
  if (card.type === 'money') sub = card.value;
  else if (card.type === 'property') sub = COLOR_ORDER[card.color] ?? 0;
  else if (card.type === 'property_wildcard') {
    const wc = card as WildcardCard;
    sub = wc.currentColor ? COLOR_ORDER[wc.currentColor] : 0;
  } else if (card.type === 'action') sub = ACTION_TYPE_ORDER[card.actionType] ?? 0;
  else if (card.type === 'rent') {
    const colors = card.colors === 'all' ? PROPERTY_COLORS : card.colors;
    sub = COLOR_ORDER[colors[0]] ?? 0;
  }
  return typeOrd * 1000 + sub;
}

export function sortHand(hand: AnyCard[]): AnyCard[] {
  return [...hand].sort((a, b) => cardSortKey(a) - cardSortKey(b));
}

// ─── Action space layout ──────────────────────────────────────────────────
//   0          = end-turn
//   1..10      = play card [0..9] default
//   11..20     = bank card [0..9] as money
//   21..30     = play card [0..9] targeting opponent 0
//   31..40     = play card [0..9] targeting opponent 1
//   41..50     = play card [0..9] targeting opponent 2
//   51..60     = play card [0..9] + DTR stacked
//   61         = respond: accept
//   62         = respond: reject (JSN)
//   63..72     = discard card [0..9]
//   73         = finish payment (only when amountPaid >= amountOwed)
//   74..83     = pay with payable card [0..9]
//   84..93     = rearrange wildcard to color [0..9]
//   94         = skip rearrange

// ─── Play-phase actions ───────────────────────────────────────────────────

export function enumeratePlayActions(
  state: GameState,
  hand: AnyCard[],
  myId: string,
): ActionCandidate[] {
  const candidates: ActionCandidate[] = [];
  const me = state.players.find(p => p.id === myId)!;
  const opponents = state.players.filter(p => p.id !== myId);

  candidates.push({ index: 0, action: { type: 'end-turn' } });

  const sorted = sortHand(hand);
  const maxCards = Math.min(sorted.length, 10);
  const hasDTR = sorted.some(c => c.type === 'action' && c.actionType === 'double_the_rent');

  for (let ci = 0; ci < maxCards; ci++) {
    const card = sorted[ci];

    // ── Default play (1..10) ──────────────────────────────────
    const defaultAction = buildDefaultPlay(card, me);
    if (defaultAction) {
      candidates.push({ index: 1 + ci, action: defaultAction });
    }

    // ── Bank as money (11..20) ────────────────────────────────
    if (card.type !== 'property' && card.type !== 'property_wildcard') {
      candidates.push({
        index: 11 + ci,
        action: { type: 'play-card', cardId: card.id, opts: { asMoney: true } },
      });
    }

    // ── Per-opponent targeting (21..50) ───────────────────────
    if (isTargetable(card)) {
      for (let oi = 0; oi < Math.min(opponents.length, 3); oi++) {
        const targetAction = buildTargetedPlay(card, me, opponents[oi], opponents);
        if (targetAction) {
          candidates.push({ index: 21 + oi * 10 + ci, action: targetAction });
        }
      }
    }

    // ── DTR combo (51..60) ────────────────────────────────────
    if (card.type === 'rent' && hasDTR && card.id !== sorted.find(c => c.type === 'action' && c.actionType === 'double_the_rent')?.id) {
      if (state.actionsRemaining >= 2) {
        const dtrCard = sorted.find(c => c.type === 'action' && c.actionType === 'double_the_rent');
        if (dtrCard) {
          const rentAction = buildRentWithDTR(card, me, opponents, dtrCard);
          if (rentAction) {
            candidates.push({ index: 51 + ci, action: rentAction });
          }
        }
      }
    }
  }

  return candidates;
}

// ─── Response-phase actions ───────────────────────────────────────────────

export function enumerateResponseActions(
  hand: AnyCard[],
  pending: PendingAction,
): ActionCandidate[] {
  const candidates: ActionCandidate[] = [];

  // Always can accept
  candidates.push({ index: 61, action: { type: 'respond-accept' } });

  // Can reject only if we have JSN
  const hasJSN = hand.some(c => c.type === 'action' && c.actionType === 'just_say_no');
  if (hasJSN) {
    candidates.push({ index: 62, action: { type: 'respond-reject' } });
  }

  return candidates;
}

// ─── Discard-phase actions ────────────────────────────────────────────────

export function enumerateDiscardActions(hand: AnyCard[]): ActionCandidate[] {
  const candidates: ActionCandidate[] = [];
  const sorted = sortHand(hand);
  const maxCards = Math.min(sorted.length, 10);

  for (let ci = 0; ci < maxCards; ci++) {
    candidates.push({
      index: 63 + ci,
      action: { type: 'discard', cardId: sorted[ci].id },
    });
  }

  return candidates;
}

// ─── Valid mask builder ───────────────────────────────────────────────────

export function buildValidMask(candidates: ActionCandidate[]): boolean[] {
  const mask = new Array<boolean>(MAX_ACTIONS).fill(false);
  for (const c of candidates) mask[c.index] = true;
  return mask;
}

// ─── Legacy compatible enumeration (for old REINFORCE code) ───────────────

export function enumerateActions(
  state: GameState,
  hand: AnyCard[],
  myId: string,
): ActionCandidate[] {
  return enumeratePlayActions(state, hand, myId);
}

// ─── Build helpers ────────────────────────────────────────────────────────

function buildDefaultPlay(card: AnyCard, me: Player): AIAction | null {
  if (card.type === 'property') {
    return { type: 'play-card', cardId: card.id, opts: {} };
  }
  if (card.type === 'property_wildcard') {
    const wc = card as WildcardCard;
    const color = pickBestWildcardColor(wc, me);
    return { type: 'play-card', cardId: card.id, opts: { color } };
  }
  if (card.type === 'money') {
    return { type: 'play-card', cardId: card.id, opts: {} };
  }
  if (card.type === 'action') {
    switch (card.actionType) {
      case 'pass_go':
      case 'its_my_birthday':
        return { type: 'play-card', cardId: card.id, opts: {} };
      case 'house': {
        const houseSet = findBestSetForUpgrade(me, false);
        if (houseSet) return { type: 'play-card', cardId: card.id, opts: { color: houseSet.color } };
        return null;
      }
      case 'hotel': {
        const hotelSet = findBestSetForUpgrade(me, true);
        if (hotelSet) return { type: 'play-card', cardId: card.id, opts: { color: hotelSet.color } };
        return null;
      }
      case 'just_say_no':
      case 'double_the_rent':
        return null; // Reactive only
      default:
        return null; // Targeted cards handled in per-opponent slots
    }
  }
  if (card.type === 'rent') {
    return buildUntargetedRent(card, me);
  }
  return null;
}

function isTargetable(card: AnyCard): boolean {
  if (card.type === 'action') {
    return ['debt_collector', 'deal_breaker', 'sly_deal', 'forced_deal'].includes(card.actionType);
  }
  if (card.type === 'rent') {
    return card.colors === 'all'; // Wild rent needs a target
  }
  return false;
}

function buildTargetedPlay(
  card: AnyCard,
  me: Player,
  target: Player,
  allOpponents: Player[],
): AIAction | null {
  if (card.type === 'action') {
    switch (card.actionType) {
      case 'debt_collector':
        return { type: 'play-card', cardId: card.id, opts: { targetPlayerId: target.id } };
      case 'deal_breaker': {
        const completeSets = target.propertySets.filter(s => s.isComplete);
        if (completeSets.length === 0) return null;
        let bestSet = completeSets[0];
        let bestVal = 0;
        for (const s of completeSets) {
          const pc = s.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length;
          const ri = Math.min(pc, RENT_VALUES[s.color].length) - 1;
          let val = RENT_VALUES[s.color][ri] || 0;
          if (s.hasHouse) val += 3;
          if (s.hasHotel) val += 4;
          if (val > bestVal) { bestVal = val; bestSet = s; }
        }
        return { type: 'play-card', cardId: card.id, opts: { targetPlayerId: target.id, targetSetColor: bestSet.color } };
      }
      case 'sly_deal': {
        const stealable = findBestStealableCard(target, me);
        if (!stealable) return null;
        return { type: 'play-card', cardId: card.id, opts: { targetPlayerId: target.id, targetCardId: stealable.id } };
      }
      case 'forced_deal': {
        const myTradeable = findWorstTradeable(me);
        if (!myTradeable) return null;
        const theirCard = findBestStealableCard(target, me);
        if (!theirCard) return null;
        return {
          type: 'play-card', cardId: card.id,
          opts: { targetPlayerId: target.id, targetCardId: theirCard.id, offeredCardId: myTradeable.id },
        };
      }
      default:
        return null;
    }
  }
  if (card.type === 'rent' && card.colors === 'all') {
    const rentAction = buildUntargetedRent(card, me);
    if (!rentAction || rentAction.type !== 'play-card') return null;
    return { type: 'play-card', cardId: card.id, opts: { ...rentAction.opts, targetPlayerId: target.id } };
  }
  return null;
}

function buildUntargetedRent(card: AnyCard, me: Player): AIAction | null {
  if (card.type !== 'rent') return null;
  const colors = card.colors === 'all' ? PROPERTY_COLORS : card.colors;
  let bestColor: PropertyColor | undefined;
  let bestAmount = 0;
  for (const color of colors) {
    const set = me.propertySets.find(s => s.color === color);
    if (!set || set.cards.length === 0) continue;
    const propCount = set.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length;
    const rentIdx = Math.min(propCount, RENT_VALUES[color].length) - 1;
    let amount = RENT_VALUES[color][rentIdx] || 0;
    if (set.hasHouse) amount += 3;
    if (set.hasHotel) amount += 4;
    if (amount > bestAmount) { bestAmount = amount; bestColor = color; }
  }
  if (!bestColor || bestAmount === 0) return null;
  return { type: 'play-card', cardId: card.id, opts: { color: bestColor } };
}

function buildRentWithDTR(
  card: AnyCard,
  me: Player,
  opponents: Player[],
  dtrCard: AnyCard,
): AIAction | null {
  const baseRent = buildUntargetedRent(card, me);
  if (!baseRent || baseRent.type !== 'play-card') return null;
  const opts: PlayCardOpts = { ...baseRent.opts, doubleTheRentCardIds: [dtrCard.id] };
  if (card.type === 'rent' && card.colors === 'all') {
    const richest = pickRichestOpponent(opponents);
    if (richest) opts.targetPlayerId = richest.id;
  }
  return { type: 'play-card', cardId: card.id, opts };
}

// ─── Rearrange-phase actions ──────────────────────────────────────────────

export function enumerateRearrangeActions(me: Player): ActionCandidate[] {
  const bestPerColor = new Map<number, { cardId: string; toColor: PropertyColor; score: number }>();

  for (const set of me.propertySets) {
    for (const c of set.cards) {
      if (c.type !== 'property_wildcard') continue;
      const wc = c as WildcardCard;
      const validColors = wc.colors === 'all' ? PROPERTY_COLORS : wc.colors;
      // Score the source set: higher = less important to keep this wildcard here
      const srcPropCount = set.cards.filter(x => x.type === 'property' || x.type === 'property_wildcard').length;
      const srcExcess = srcPropCount - SET_SIZE[set.color];
      for (const toColor of validColors) {
        if (toColor === set.color) continue;
        const colorIdx = PROPERTY_COLORS.indexOf(toColor);
        if (colorIdx === -1) continue;
        // Prefer moving from sets with excess cards, toward sets that need cards
        const destSet = me.propertySets.find(s => s.color === toColor && !s.isComplete);
        const destProgress = destSet
          ? destSet.cards.filter(x => x.type === 'property' || x.type === 'property_wildcard').length / SET_SIZE[toColor]
          : 0;
        const score = srcExcess * 100 + destProgress * 1000;
        const existing = bestPerColor.get(colorIdx);
        if (!existing || score > existing.score) {
          bestPerColor.set(colorIdx, { cardId: c.id, toColor, score });
        }
      }
    }
  }

  const candidates: ActionCandidate[] = [];
  for (const [colorIdx, entry] of bestPerColor) {
    candidates.push({
      index: 84 + colorIdx,
      action: { type: 'rearrange', cardId: entry.cardId, toColor: entry.toColor },
    });
  }

  candidates.push({ index: 94, action: { type: 'skip-rearrange' } });
  return candidates;
}

// ─── Payment-phase actions ────────────────────────────────────────────────

export function buildPayableCardPool(me: Player): AnyCard[] {
  const bankCards = [...me.bank].sort((a, b) => a.value - b.value);
  const nonCompletePropCards: AnyCard[] = [];
  const completePropCards: AnyCard[] = [];
  for (const set of me.propertySets) {
    for (const c of set.cards) {
      if (c.type === 'property_wildcard' && (c as WildcardCard).colors === 'all') continue;
      if (c.type !== 'property' && c.type !== 'property_wildcard') continue;
      if (set.isComplete) completePropCards.push(c);
      else nonCompletePropCards.push(c);
    }
  }
  nonCompletePropCards.sort((a, b) => a.value - b.value);
  completePropCards.sort((a, b) => a.value - b.value);
  return [...bankCards, ...nonCompletePropCards, ...completePropCards];
}

export function enumeratePaymentActions(
  me: Player,
  amountOwed: number,
  amountPaidSoFar: number,
  excludeIds: Set<string>,
): ActionCandidate[] {
  const candidates: ActionCandidate[] = [];

  if (amountPaidSoFar >= amountOwed) {
    candidates.push({ index: 73, action: { type: 'finish-payment' } });
    return candidates;
  }

  const pool = buildPayableCardPool(me).filter(c => !excludeIds.has(c.id));
  const maxCards = Math.min(pool.length, 10);
  for (let i = 0; i < maxCards; i++) {
    candidates.push({ index: 74 + i, action: { type: 'pay', cardId: pool[i].id } });
  }

  if (candidates.length === 0) {
    candidates.push({ index: 73, action: { type: 'finish-payment' } });
  }

  return candidates;
}

// ─── Utility helpers ──────────────────────────────────────────────────────

function pickBestWildcardColor(wc: WildcardCard, me: Player): PropertyColor {
  const colors = wc.colors === 'all' ? PROPERTY_COLORS : wc.colors;
  let best: PropertyColor = colors[0];
  let bestScore = -1;
  for (const color of colors) {
    const set = me.propertySets.find(s => s.color === color && !s.isComplete);
    const current = set ? set.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length : 0;
    const score = (current + 1) / SET_SIZE[color];
    if (score > bestScore) { bestScore = score; best = color; }
  }
  return best;
}

function pickRichestOpponent(opponents: Player[]): Player | undefined {
  let best: Player | undefined;
  let bestVal = -1;
  for (const opp of opponents) {
    const val = opp.bank.reduce((s, c) => s + c.value, 0) +
      opp.propertySets.reduce((s, set) => s + set.cards.reduce((s2, c) => s2 + c.value, 0), 0);
    if (val > bestVal) { bestVal = val; best = opp; }
  }
  return best;
}

function findBestStealableCard(target: Player, me: Player): AnyCard | null {
  let best: AnyCard | null = null;
  let bestScore = -1;
  for (const set of target.propertySets) {
    if (set.isComplete) continue;
    for (const c of set.cards) {
      if (c.type !== 'property' && c.type !== 'property_wildcard') continue;
      const color = c.type === 'property' ? c.color : (c as WildcardCard).currentColor;
      if (!color) continue;
      const mySet = me.propertySets.find(s => s.color === color && !s.isComplete);
      const progress = mySet
        ? mySet.cards.filter(x => x.type === 'property' || x.type === 'property_wildcard').length / SET_SIZE[color]
        : 0;
      const score = progress * 1000 + c.value;
      if (score > bestScore) { bestScore = score; best = c; }
    }
  }
  return best;
}

function findWorstTradeable(me: Player): AnyCard | null {
  let worst: AnyCard | null = null;
  let worstScore = Infinity;
  for (const set of me.propertySets) {
    if (set.isComplete) continue;
    const propCount = set.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length;
    const gapToComplete = SET_SIZE[set.color] - propCount;
    for (const c of set.cards) {
      if (c.type !== 'property' && c.type !== 'property_wildcard') continue;
      const score = gapToComplete * 100 - c.value;
      if (score < worstScore) { worstScore = score; worst = c; }
    }
  }
  return worst;
}

function findBestSetForUpgrade(me: Player, needsHouse: boolean): { color: PropertyColor } | null {
  let bestSet: { color: PropertyColor } | null = null;
  let bestRent = 0;
  for (const s of me.propertySets) {
    if (!s.isComplete || s.color === 'railroad' || s.color === 'utility') continue;
    if (needsHouse) { if (!s.hasHouse || s.hasHotel) continue; }
    else { if (s.hasHouse) continue; }
    const pc = s.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length;
    const rent = RENT_VALUES[s.color][Math.min(pc, RENT_VALUES[s.color].length) - 1] || 0;
    if (rent > bestRent) { bestRent = rent; bestSet = { color: s.color }; }
  }
  return bestSet;
}
