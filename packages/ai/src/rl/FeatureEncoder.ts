import {
  PROPERTY_COLORS, SET_SIZE, RENT_VALUES,
  type GameState, type AnyCard, type Player, type PropertyColor,
  type ActionType, type WildcardCard, type PendingAction,
} from '@monopoly-deal/shared';
import { sortHand } from './ActionSpace.js';

const NUM_COLORS = PROPERTY_COLORS.length; // 10
const ACTION_TYPES: ActionType[] = [
  'pass_go', 'deal_breaker', 'just_say_no', 'sly_deal',
  'forced_deal', 'debt_collector', 'its_my_birthday',
  'house', 'hotel', 'double_the_rent',
];
const MONEY_DENOMS = [1, 2, 3, 4, 5, 10];
const MAX_OPPONENTS = 3;

// Pre-built lookup tables for O(1) index resolution (avoids Map overhead)
const MONEY_DENOM_IDX: Record<number, number> = {};
for (let i = 0; i < MONEY_DENOMS.length; i++) MONEY_DENOM_IDX[MONEY_DENOMS[i]] = i;
const COLOR_IDX: Record<string, number> = {};
for (let i = 0; i < PROPERTY_COLORS.length; i++) COLOR_IDX[PROPERTY_COLORS[i]] = i;
const ACTION_IDX: Record<string, number> = {};
for (let i = 0; i < ACTION_TYPES.length; i++) ACTION_IDX[ACTION_TYPES[i]] = i;

// Pre-allocated count buffers (reused per encodeState call — single-threaded safe)
const _moneyBuf = new Uint8Array(MONEY_DENOMS.length);
const _propBuf = new Uint8Array(NUM_COLORS);
const _actionBuf = new Uint8Array(ACTION_TYPES.length);
const _rentBuf = new Uint8Array(NUM_COLORS);

// Deck composition constants (from deck.ts: 106 cards total)
const DECK_ACTION_COUNTS: Record<string, number> = {
  pass_go: 10, deal_breaker: 2, just_say_no: 3, sly_deal: 3,
  forced_deal: 3, debt_collector: 3, its_my_birthday: 3,
  house: 3, hotel: 2, double_the_rent: 2,
};
// Properties per color in deck (property cards + wildcards applicable to each color)
const DECK_PROPERTY_COUNTS: Record<string, number> = {
  brown: 2 + 1,         // 2 properties + 1 wildcard (light_blue/brown)
  blue: 2 + 1,          // 2 properties + 1 wildcard (green/blue)
  green: 3 + 2,         // 3 properties + green/railroad + green/blue
  light_blue: 3 + 2,    // 3 properties + light_blue/railroad + light_blue/brown
  orange: 3 + 2,        // 3 properties + 2x orange/pink
  pink: 3 + 2,          // 3 properties + 2x orange/pink
  railroad: 4 + 3,      // 4 properties + green/railroad + light_blue/railroad + railroad/utility
  red: 3 + 2,           // 3 properties + 2x red/yellow
  yellow: 3 + 2,        // 3 properties + 2x red/yellow
  utility: 2 + 1,       // 2 properties + railroad/utility
};
const DECK_WILD_RENT_COUNT = 3;   // 3 wild rent cards in deck
const DECK_MULTICOLOR_WC = 2;     // 2 "all" wildcards (applicable to any color)

// Card counting scratch buffers
const _seenActionBuf = new Float32Array(ACTION_TYPES.length);
const _seenPropBuf = new Float32Array(NUM_COLORS);
const _seenWildRent = { count: 0 };

export const FEATURE_SIZE = 256; // 188 base + 60 per-slot card features + 8 padding

export interface PaymentContext {
  amountOwed: number;
  amountPaidSoFar: number;
}

/** Count property + property_wildcard cards in a set's cards array (inline, no .filter()) */
function countPropCards(cards: AnyCard[]): number {
  let n = 0;
  for (let i = 0; i < cards.length; i++) {
    const t = cards[i].type;
    if (t === 'property' || t === 'property_wildcard') n++;
  }
  return n;
}

/** Count complete sets (inline, no .filter()) */
function countComplete(sets: Player['propertySets']): number {
  let n = 0;
  for (let i = 0; i < sets.length; i++) if (sets[i].isComplete) n++;
  return n;
}

export function encodeState(
  state: GameState, hand: AnyCard[], myId: string,
  paymentCtx?: PaymentContext,
  discardPile?: AnyCard[],
): Float32Array {
  const features = new Float32Array(FEATURE_SIZE);
  let idx = 0;

  // ─── Hand composition (36 features) ──────────────────────────
  // Zero the reusable count buffers
  _moneyBuf.fill(0);
  _propBuf.fill(0);
  _actionBuf.fill(0);
  _rentBuf.fill(0);

  for (let ci = 0; ci < hand.length; ci++) {
    const card = hand[ci];
    if (card.type === 'money') {
      const di = MONEY_DENOM_IDX[card.value];
      if (di !== undefined) _moneyBuf[di]++;
      else _moneyBuf[0]++; // fallback to denom 1
    } else if (card.type === 'property') {
      const ci2 = COLOR_IDX[card.color];
      if (ci2 !== undefined) _propBuf[ci2]++;
    } else if (card.type === 'property_wildcard') {
      const wc = card as WildcardCard;
      const color = wc.currentColor ?? (wc.colors === 'all' ? 'brown' : wc.colors[0]);
      const ci2 = COLOR_IDX[color];
      if (ci2 !== undefined) _propBuf[ci2]++;
    } else if (card.type === 'action') {
      const ai = ACTION_IDX[card.actionType];
      if (ai !== undefined) _actionBuf[ai]++;
    } else if (card.type === 'rent') {
      const colors = card.colors === 'all' ? PROPERTY_COLORS : card.colors;
      for (let ri = 0; ri < colors.length; ri++) {
        const ci2 = COLOR_IDX[colors[ri]];
        if (ci2 !== undefined) _rentBuf[ci2]++;
      }
    }
  }

  for (let i = 0; i < MONEY_DENOMS.length; i++) features[idx++] = _moneyBuf[i] / 3;
  for (let i = 0; i < NUM_COLORS; i++) features[idx++] = _propBuf[i] / 3;
  for (let i = 0; i < ACTION_TYPES.length; i++) features[idx++] = _actionBuf[i] / 2;
  for (let i = 0; i < NUM_COLORS; i++) features[idx++] = _rentBuf[i] / 2;

  // ─── My board (24 features) ─────────────────────────────────
  const me = state.players.find(p => p.id === myId)!;
  for (let ci2 = 0; ci2 < NUM_COLORS; ci2++) {
    const color = PROPERTY_COLORS[ci2];
    const set = me.propertySets.find(s => s.color === color);
    const propCards = set ? countPropCards(set.cards) : 0;
    features[idx++] = propCards / SET_SIZE[color];
  }
  for (let ci2 = 0; ci2 < NUM_COLORS; ci2++) {
    const color = PROPERTY_COLORS[ci2];
    const set = me.propertySets.find(s => s.color === color);
    features[idx++] = set?.isComplete ? 1 : 0;
  }
  let bankValue = 0;
  for (let i = 0; i < me.bank.length; i++) bankValue += me.bank[i].value;
  features[idx++] = Math.min(bankValue / 20, 1);
  features[idx++] = Math.min(me.bank.length / 10, 1);
  const completeSets = countComplete(me.propertySets);
  features[idx++] = completeSets / 3;
  let hasHouse = false;
  for (let i = 0; i < me.propertySets.length; i++) { if (me.propertySets[i].hasHouse) { hasHouse = true; break; } }
  features[idx++] = hasHouse ? 1 : 0;

  // ─── Opponents (14 × 3 = 42 features) ──────────────────────
  const opponents = state.players.filter(p => p.id !== myId);
  for (let oi = 0; oi < MAX_OPPONENTS; oi++) {
    const opp = opponents[oi];
    if (!opp) { idx += 14; continue; }
    for (let ci2 = 0; ci2 < NUM_COLORS; ci2++) {
      const color = PROPERTY_COLORS[ci2];
      const set = opp.propertySets.find(s => s.color === color);
      const propCards = set ? countPropCards(set.cards) : 0;
      features[idx++] = propCards / SET_SIZE[color];
    }
    features[idx++] = countComplete(opp.propertySets) / 3;
    let oppBank = 0;
    for (let i = 0; i < opp.bank.length; i++) oppBank += opp.bank[i].value;
    features[idx++] = Math.min(oppBank / 20, 1);
    features[idx++] = Math.min(opp.handCount / 10, 1);
    let maxProgress = 0;
    for (let si = 0; si < opp.propertySets.length; si++) {
      const set = opp.propertySets[si];
      if (set.isComplete) { maxProgress = 1; break; }
      const propCards = countPropCards(set.cards);
      const progress = propCards / SET_SIZE[set.color];
      if (progress > maxProgress) maxProgress = progress;
    }
    features[idx++] = maxProgress;
  }

  // ─── Turn context (14 features) ─────────────────────────────
  features[idx++] = state.actionsRemaining / 3;
  features[idx++] = Math.min(state.turnNumber / 40, 1);
  features[idx++] = hand.length / 10;

  // Phase one-hot (4)
  const tp = state.turnPhase;
  features[idx++] = tp === 'draw' ? 1 : 0;
  features[idx++] = tp === 'action' ? 1 : 0;
  features[idx++] = tp === 'discard' ? 1 : 0;
  features[idx++] = tp === 'waiting' ? 1 : 0;

  // Pending action type one-hot (7: none + 6 types)
  const pa = state.pendingAction;
  features[idx++] = pa ? 0 : 1;
  features[idx++] = pa?.type === 'rent' ? 1 : 0;
  features[idx++] = pa?.type === 'debt_collector' ? 1 : 0;
  features[idx++] = pa?.type === 'its_my_birthday' ? 1 : 0;
  features[idx++] = pa?.type === 'deal_breaker' ? 1 : 0;
  features[idx++] = pa?.type === 'sly_deal' ? 1 : 0;
  features[idx++] = pa?.type === 'forced_deal' ? 1 : 0;

  // ─── PPO features ───────────────────────────────────────────
  // DTR + JSN counts from hand (use pre-computed action buf)
  features[idx++] = Math.min((_actionBuf[ACTION_IDX['double_the_rent']] ?? 0) / 2, 1);
  features[idx++] = Math.min((_actionBuf[ACTION_IDX['just_say_no']] ?? 0) / 2, 1);

  // Pending action details (6)
  features[idx++] = pa ? Math.min((pa.amount ?? 0) / 10, 1) : 0;
  if (pa) {
    const srcIdx = opponents.findIndex(o => o.id === pa.sourcePlayerId);
    for (let i = 0; i < MAX_OPPONENTS; i++) features[idx++] = srcIdx === i ? 1 : 0;
  } else {
    idx += MAX_OPPONENTS;
  }
  let hasCompleteSet = false;
  for (let i = 0; i < me.propertySets.length; i++) { if (me.propertySets[i].isComplete) { hasCompleteSet = true; break; } }
  features[idx++] = (pa && pa.type === 'deal_breaker' && hasCompleteSet) ? 1 : 0;

  let hasNearComplete = false;
  if (pa && (pa.type === 'sly_deal' || pa.type === 'forced_deal')) {
    for (let i = 0; i < me.propertySets.length; i++) {
      const s = me.propertySets[i];
      if (!s.isComplete && countPropCards(s.cards) >= SET_SIZE[s.color] - 1) { hasNearComplete = true; break; }
    }
  }
  features[idx++] = hasNearComplete ? 1 : 0;

  // Deck remaining (1)
  features[idx++] = Math.min(state.drawPileCount / 40, 1);

  // Turn position (1)
  const myPlayerIdx = state.players.findIndex(p => p.id === myId);
  features[idx++] = myPlayerIdx / Math.max(state.players.length - 1, 1);

  // Am I the current player? (1)
  features[idx++] = state.currentPlayerIndex === myPlayerIdx ? 1 : 0;

  // ─── Payment-phase features (4) ───────────────────────────
  if (paymentCtx) {
    features[idx++] = 1;
    features[idx++] = Math.min(paymentCtx.amountOwed / 10, 1);
    features[idx++] = Math.min(paymentCtx.amountPaidSoFar / 10, 1);
    const owed = Math.max(paymentCtx.amountOwed, 1);
    features[idx++] = Math.max(0, paymentCtx.amountPaidSoFar - paymentCtx.amountOwed) / owed;
  } else {
    idx += 4;
  }

  // ─── Rearrangeable wildcards on board (1) ──────────────────
  let rearrangeableCount = 0;
  for (let si = 0; si < me.propertySets.length; si++) {
    const cards = me.propertySets[si].cards;
    for (let ci2 = 0; ci2 < cards.length; ci2++) {
      if (cards[ci2].type === 'property_wildcard') rearrangeableCount++;
    }
  }
  features[idx++] = Math.min(rearrangeableCount / 3, 1);

  // ─── Enriched strategic features (8) ───────────────────────
  for (let oi = 0; oi < MAX_OPPONENTS; oi++) {
    const opp = opponents[oi];
    if (!opp) { idx++; continue; }
    let nearComplete = 0;
    for (let si = 0; si < opp.propertySets.length; si++) {
      const set = opp.propertySets[si];
      if (set.isComplete) continue;
      const pc = countPropCards(set.cards);
      if (pc >= SET_SIZE[set.color] - 1 && pc > 0) nearComplete++;
    }
    features[idx++] = Math.min(nearComplete / 3, 1);
  }

  let myNearComplete = 0;
  for (let si = 0; si < me.propertySets.length; si++) {
    const set = me.propertySets[si];
    if (set.isComplete) continue;
    const pc = countPropCards(set.cards);
    if (pc >= SET_SIZE[set.color] - 1 && pc > 0) myNearComplete++;
  }
  features[idx++] = Math.min(myNearComplete / 3, 1);

  let totalOppHands = 0;
  for (let oi = 0; oi < opponents.length; oi++) totalOppHands += opponents[oi].handCount;
  features[idx++] = Math.min(totalOppHands / 30, 1);

  for (let oi = 0; oi < MAX_OPPONENTS; oi++) {
    const opp = opponents[oi];
    if (!opp) { idx++; continue; }
    features[idx++] = (3 - countComplete(opp.propertySets)) / 3;
  }

  // ─── Win-proximity features (5) ────────────────────────────
  features[idx++] = computeWinProximity(me) / 10;

  for (let oi = 0; oi < MAX_OPPONENTS; oi++) {
    const opp = opponents[oi];
    if (!opp) { idx++; continue; }
    features[idx++] = computeWinProximity(opp) / 10;
  }

  // Rent-color-match: do I hold rent cards for my best (most progressed) sets?
  let rentMatch = 0;
  // Find top 2 incomplete sets by progress (inline sort avoid)
  let best1Score = -1, best1Color = -1;
  let best2Score = -1, best2Color = -1;
  for (let si = 0; si < me.propertySets.length; si++) {
    const s = me.propertySets[si];
    if (s.isComplete) continue;
    const score = countPropCards(s.cards) / SET_SIZE[s.color];
    const ci2 = COLOR_IDX[s.color] ?? -1;
    if (score > best1Score) {
      best2Score = best1Score; best2Color = best1Color;
      best1Score = score; best1Color = ci2;
    } else if (score > best2Score) {
      best2Score = score; best2Color = ci2;
    }
  }
  if (best1Color >= 0 && _rentBuf[best1Color] > 0) rentMatch++;
  if (best2Color >= 0 && _rentBuf[best2Color] > 0) rentMatch++;
  features[idx++] = rentMatch / 2;

  // ─── A. Card counting features (21) ──────────────────────────
  // Tally seen cards from hand + all boards + all banks + discard pile
  _seenActionBuf.fill(0);
  _seenPropBuf.fill(0);
  _seenWildRent.count = 0;

  const hasDiscard = discardPile && discardPile.length > 0;

  // Helper: tally a single card into seen buffers
  const tallySeen = (card: AnyCard) => {
    if (card.type === 'action') {
      const ai = ACTION_IDX[card.actionType];
      if (ai !== undefined) _seenActionBuf[ai]++;
    } else if (card.type === 'property') {
      const ci = COLOR_IDX[card.color];
      if (ci !== undefined) _seenPropBuf[ci]++;
    } else if (card.type === 'property_wildcard') {
      const wc = card as WildcardCard;
      if (wc.colors === 'all') {
        // Multi-color wildcard: count toward each color
        for (let c = 0; c < NUM_COLORS; c++) _seenPropBuf[c]++;
      } else {
        for (const col of wc.colors) {
          const ci = COLOR_IDX[col];
          if (ci !== undefined) _seenPropBuf[ci]++;
        }
      }
    } else if (card.type === 'rent') {
      if (card.colors === 'all') _seenWildRent.count++;
    }
  };

  // Tally hand
  for (let i = 0; i < hand.length; i++) tallySeen(hand[i]);
  // Tally all boards + banks
  for (let pi = 0; pi < state.players.length; pi++) {
    const p = state.players[pi];
    for (let si = 0; si < p.propertySets.length; si++) {
      const cards = p.propertySets[si].cards;
      for (let ci = 0; ci < cards.length; ci++) tallySeen(cards[ci]);
    }
    for (let bi = 0; bi < p.bank.length; bi++) tallySeen(p.bank[bi]);
  }
  // Tally discard pile
  if (hasDiscard) {
    for (let i = 0; i < discardPile!.length; i++) tallySeen(discardPile![i]);
  }

  // 10 key action card remaining fractions
  for (let i = 0; i < ACTION_TYPES.length; i++) {
    const total = DECK_ACTION_COUNTS[ACTION_TYPES[i]] ?? 0;
    if (!hasDiscard) { features[idx++] = 0.5; }
    else { features[idx++] = total > 0 ? Math.max(0, total - _seenActionBuf[i]) / total : 0; }
  }
  // 10 property-per-color remaining fractions
  for (let ci = 0; ci < NUM_COLORS; ci++) {
    const color = PROPERTY_COLORS[ci];
    const total = (DECK_PROPERTY_COUNTS[color] ?? 0) + DECK_MULTICOLOR_WC;
    if (!hasDiscard) { features[idx++] = 0.5; }
    else { features[idx++] = total > 0 ? Math.max(0, total - _seenPropBuf[ci]) / total : 0; }
  }
  // 1 wild rent remaining fraction
  if (!hasDiscard) { features[idx++] = 0.5; }
  else { features[idx++] = Math.max(0, DECK_WILD_RENT_COUNT - _seenWildRent.count) / DECK_WILD_RENT_COUNT; }

  // ─── B. Opponent extractable wealth (9) ──────────────────────
  for (let oi = 0; oi < MAX_OPPONENTS; oi++) {
    const opp = opponents[oi];
    if (!opp) { idx += 3; continue; }
    features[idx++] = Math.min(opp.bank.length / 10, 1);
    let oppTotalProps = 0;
    for (let si = 0; si < opp.propertySets.length; si++) oppTotalProps += countPropCards(opp.propertySets[si].cards);
    features[idx++] = Math.min(oppTotalProps / 10, 1);
    let oppPropValue = 0;
    for (let si = 0; si < opp.propertySets.length; si++) {
      for (let ci = 0; ci < opp.propertySets[si].cards.length; ci++) oppPropValue += opp.propertySets[si].cards[ci].value;
    }
    features[idx++] = Math.min(oppPropValue / 20, 1);
  }

  // ─── C. Vulnerability / stealability (5) ─────────────────────
  // Stealable = cards in incomplete sets (not multicolor wildcards)
  let myStealable = 0, myStealableValue = 0;
  for (let si = 0; si < me.propertySets.length; si++) {
    const s = me.propertySets[si];
    if (s.isComplete) continue;
    for (let ci = 0; ci < s.cards.length; ci++) {
      const c = s.cards[ci];
      if (c.type === 'property_wildcard' && (c as WildcardCard).colors === 'all') continue;
      if (c.type === 'property' || c.type === 'property_wildcard') {
        myStealable++;
        myStealableValue += c.value;
      }
    }
  }
  features[idx++] = Math.min(myStealable / 5, 1);
  features[idx++] = Math.min(myStealableValue / 10, 1);

  let maxOppStealable = 0;
  for (let oi = 0; oi < opponents.length; oi++) {
    const opp = opponents[oi];
    let oppStealable = 0;
    for (let si = 0; si < opp.propertySets.length; si++) {
      const s = opp.propertySets[si];
      if (s.isComplete) continue;
      oppStealable += countPropCards(s.cards);
    }
    if (oppStealable > maxOppStealable) maxOppStealable = oppStealable;
  }
  features[idx++] = Math.min(maxOppStealable / 5, 1);

  // Am I the richest target? (bank + property value)
  let myTableValue = bankValue;
  for (let si = 0; si < me.propertySets.length; si++) {
    for (let ci = 0; ci < me.propertySets[si].cards.length; ci++) myTableValue += me.propertySets[si].cards[ci].value;
  }
  let meanOppValue = 0;
  for (let oi = 0; oi < opponents.length; oi++) {
    let oppVal = 0;
    const opp = opponents[oi];
    for (let bi = 0; bi < opp.bank.length; bi++) oppVal += opp.bank[bi].value;
    for (let si = 0; si < opp.propertySets.length; si++) {
      for (let ci = 0; ci < opp.propertySets[si].cards.length; ci++) oppVal += opp.propertySets[si].cards[ci].value;
    }
    meanOppValue += oppVal;
  }
  meanOppValue = opponents.length > 0 ? meanOppValue / opponents.length : 0;
  features[idx++] = myTableValue > meanOppValue ? 1 : 0;
  features[idx++] = meanOppValue > 0 ? Math.min(myTableValue / meanOppValue, 2) / 2 : 0.5;

  // ─── D. Rent offense & defense (7) ───────────────────────────
  // Max rent chargeable from my sets
  let maxRent = 0;
  let maxRentWithDTR = 0;
  for (let si = 0; si < me.propertySets.length; si++) {
    const s = me.propertySets[si];
    const pc = countPropCards(s.cards);
    if (pc === 0) continue;
    const rentIdx = Math.min(pc, RENT_VALUES[s.color].length) - 1;
    let r = RENT_VALUES[s.color][rentIdx] ?? 0;
    if (s.hasHouse) r += 3;
    if (s.hasHotel) r += 4;
    if (r > maxRent) maxRent = r;
    const rDTR = r * 2;
    if (rDTR > maxRentWithDTR) maxRentWithDTR = rDTR;
  }
  features[idx++] = Math.min(maxRent / 10, 1);
  features[idx++] = Math.min(maxRentWithDTR / 20, 1);

  // Rent defense buffer: min(1, bank / maxRentAgainstMe)
  // Approximate maxRentAgainstMe as max rent any opponent could charge
  let maxRentAgainstMe = 0;
  for (let oi = 0; oi < opponents.length; oi++) {
    const opp = opponents[oi];
    for (let si = 0; si < opp.propertySets.length; si++) {
      const s = opp.propertySets[si];
      const pc = countPropCards(s.cards);
      if (pc === 0) continue;
      const rentIdx = Math.min(pc, RENT_VALUES[s.color].length) - 1;
      let r = RENT_VALUES[s.color][rentIdx] ?? 0;
      if (s.hasHouse) r += 3;
      if (s.hasHotel) r += 4;
      if (r > maxRentAgainstMe) maxRentAgainstMe = r;
    }
  }
  features[idx++] = maxRentAgainstMe > 0 ? Math.min(bankValue / maxRentAgainstMe, 1) : 1;

  // Post-worst-case buffer: what's left after paying max rent
  const postWorstCase = Math.max(0, bankValue - maxRentAgainstMe * 2);
  features[idx++] = Math.min(postWorstCase / 10, 1);

  // Per-opponent payable wealth (bank + non-complete-set property value, excl multicolor WC)
  for (let oi = 0; oi < MAX_OPPONENTS; oi++) {
    const opp = opponents[oi];
    if (!opp) { idx++; continue; }
    let payable = 0;
    for (let bi = 0; bi < opp.bank.length; bi++) payable += opp.bank[bi].value;
    for (let si = 0; si < opp.propertySets.length; si++) {
      const s = opp.propertySets[si];
      for (let ci = 0; ci < s.cards.length; ci++) {
        const c = s.cards[ci];
        if (c.type === 'property_wildcard' && (c as WildcardCard).colors === 'all') continue;
        payable += c.value;
      }
    }
    features[idx++] = Math.min(payable / 20, 1);
  }

  // ─── E. Per-slot card features (6 × 10 = 60 features) ───────
  // Encodes what card occupies each sorted hand slot so the network
  // can map action indices (play card 0-9) to card identity/strategy.
  const sorted = sortHand(hand);
  const maxSlots = Math.min(sorted.length, 10);
  for (let si = 0; si < 10; si++) {
    if (si >= maxSlots) { idx += 6; continue; }
    const card = sorted[si];
    // 1. is property or wildcard
    features[idx++] = (card.type === 'property' || card.type === 'property_wildcard') ? 1 : 0;
    // 2. is offensive action (deal_breaker, sly_deal, forced_deal, debt_collector)
    features[idx++] = (card.type === 'action' && (
      card.actionType === 'deal_breaker' || card.actionType === 'sly_deal' ||
      card.actionType === 'forced_deal' || card.actionType === 'debt_collector'
    )) ? 1 : 0;
    // 3. is rent
    features[idx++] = card.type === 'rent' ? 1 : 0;
    // 4. is utility action (pass_go, its_my_birthday, house, hotel, just_say_no, double_the_rent) or money
    features[idx++] = (card.type === 'money' || (card.type === 'action' && (
      card.actionType === 'pass_go' || card.actionType === 'its_my_birthday' ||
      card.actionType === 'house' || card.actionType === 'hotel' ||
      card.actionType === 'just_say_no' || card.actionType === 'double_the_rent'
    ))) ? 1 : 0;
    // 5. card value normalized
    features[idx++] = card.value / 10;
    // 6. strategic impact score (0-1):
    //    - property/wildcard: set completion progress if this card is played
    //    - rent: max rent chargeable from my sets for this rent's colors / 10
    //    - offensive action: 0.8 (deal_breaker=1.0, sly_deal=0.7, debt_collector=0.5, forced_deal=0.6)
    //    - pass_go: 0.4, birthday: 0.3, house/hotel: 0.5
    //    - money/other: value / 10
    features[idx++] = computeSlotImpact(card, me);
  }

  // Remaining features are zero-padded (padding to 256)

  return features;
}

function computeWinProximity(player: Player): number {
  const cs = countComplete(player.propertySets);
  if (cs >= 3) return 0;

  const needed = 3 - cs;
  const gaps: number[] = [];
  for (let si = 0; si < player.propertySets.length; si++) {
    const set = player.propertySets[si];
    if (set.isComplete) continue;
    gaps.push(SET_SIZE[set.color] - countPropCards(set.cards));
  }
  for (let ci = 0; ci < PROPERTY_COLORS.length; ci++) {
    const color = PROPERTY_COLORS[ci];
    let found = false;
    for (let si = 0; si < player.propertySets.length; si++) {
      if (player.propertySets[si].color === color) { found = true; break; }
    }
    if (!found) gaps.push(SET_SIZE[color]);
  }
  gaps.sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i < Math.min(needed, gaps.length); i++) total += gaps[i];
  return total;
}

function computeSlotImpact(card: AnyCard, me: Player): number {
  if (card.type === 'property') {
    const set = me.propertySets.find(s => s.color === card.color && !s.isComplete);
    const current = set ? countPropCards(set.cards) : 0;
    return Math.min((current + 1) / SET_SIZE[card.color], 1);
  }
  if (card.type === 'property_wildcard') {
    const wc = card as WildcardCard;
    const colors = wc.colors === 'all' ? PROPERTY_COLORS : wc.colors;
    let best = 0;
    for (const color of colors) {
      const set = me.propertySets.find(s => s.color === color && !s.isComplete);
      const current = set ? countPropCards(set.cards) : 0;
      const score = (current + 1) / SET_SIZE[color];
      if (score > best) best = score;
    }
    return Math.min(best, 1);
  }
  if (card.type === 'rent') {
    const colors = card.colors === 'all' ? PROPERTY_COLORS : card.colors;
    let bestAmount = 0;
    for (const color of colors) {
      const set = me.propertySets.find(s => s.color === color);
      if (!set) continue;
      const pc = countPropCards(set.cards);
      if (pc === 0) continue;
      const rentIdx = Math.min(pc, RENT_VALUES[color].length) - 1;
      let amount = RENT_VALUES[color][rentIdx] ?? 0;
      if (set.hasHouse) amount += 3;
      if (set.hasHotel) amount += 4;
      if (amount > bestAmount) bestAmount = amount;
    }
    return Math.min(bestAmount / 10, 1);
  }
  if (card.type === 'action') {
    switch (card.actionType) {
      case 'deal_breaker': return 1.0;
      case 'sly_deal': return 0.7;
      case 'forced_deal': return 0.6;
      case 'debt_collector': return 0.5;
      case 'pass_go': return 0.4;
      case 'house': case 'hotel': return 0.5;
      case 'its_my_birthday': return 0.3;
      case 'just_say_no': return 0.8;
      case 'double_the_rent': return 0.6;
      default: return 0.2;
    }
  }
  // money
  return card.value / 10;
}

export function encodeCardFeatures(card: AnyCard): Float32Array {
  const f = new Float32Array(8);
  f[0] = card.type === 'money' ? 1 : 0;
  f[1] = card.type === 'property' ? 1 : 0;
  f[2] = card.type === 'property_wildcard' ? 1 : 0;
  f[3] = card.type === 'action' ? 1 : 0;
  f[4] = card.type === 'rent' ? 1 : 0;
  f[5] = card.value / 10;
  f[6] = card.type === 'action' && card.actionType === 'just_say_no' ? 1 : 0;
  f[7] = card.type === 'action' && card.actionType === 'deal_breaker' ? 1 : 0;
  return f;
}
