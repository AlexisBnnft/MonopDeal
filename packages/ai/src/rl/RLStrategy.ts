import type { GameState, AnyCard, PendingAction, WildcardCard } from '@monopoly-deal/shared';
import type { AIStrategy, AIAction, AIResponse } from '../../../server/src/game/ai/types.js';
import { PolicyNetwork, type NetworkWeights } from './PolicyNetwork.js';
import { encodeState } from './FeatureEncoder.js';
import { enumerateActions, buildValidMask } from './ActionSpace.js';

export interface StepRecord {
  actionIdx: number;
  probs: Float64Array;
  entropy: number;
}

export class RLStrategy implements AIStrategy {
  private network: PolicyNetwork;
  private explore: boolean;
  public lastStep: StepRecord | null = null;
  private _lastInput: Float64Array = new Float64Array(0);
  private _lastValidMask: boolean[] = [];

  constructor(network: PolicyNetwork, explore = false) {
    this.network = network;
    this.explore = explore;
  }

  getLastForwardData(): { input: Float64Array; validMask: boolean[] } {
    return {
      input: Float64Array.from(this._lastInput),
      validMask: [...this._lastValidMask],
    };
  }

  chooseAction(state: GameState, hand: AnyCard[], myId: string): AIAction | null {
    if (hand.length === 0) return { type: 'end-turn' };

    const features = encodeState(state, hand, myId);
    const candidates = enumerateActions(state, hand, myId);

    if (candidates.length <= 1) {
      this.lastStep = null;
      return candidates[0]?.action ?? { type: 'end-turn' };
    }

    const mask = buildValidMask(candidates);
    this._lastInput = Float64Array.from(features);
    this._lastValidMask = [...mask];
    const { probs } = this.network.forward(features, mask);

    let chosenIdx: number;
    if (this.explore) {
      chosenIdx = this.network.sampleAction(probs);
    } else {
      // Greedy: pick highest prob among valid actions
      chosenIdx = 0;
      let bestP = -1;
      for (const c of candidates) {
        if (probs[c.index] > bestP) { bestP = probs[c.index]; chosenIdx = c.index; }
      }
    }

    const chosen = candidates.find(c => c.index === chosenIdx);
    const entropy = this.network.entropy(probs);

    this.lastStep = { actionIdx: chosenIdx, probs, entropy };

    return chosen?.action ?? { type: 'end-turn' };
  }

  chooseResponse(state: GameState, hand: AnyCard[], myId: string, pending: PendingAction): AIResponse {
    const me = state.players.find(p => p.id === myId);
    if (!me) return { accept: true, paymentCardIds: [] };

    // Use JSN if we have it and it's a property-targeting action
    const hasJSN = hand.some(c => c.type === 'action' && c.actionType === 'just_say_no');
    if (hasJSN && (pending.type === 'deal_breaker' || pending.type === 'sly_deal')) {
      return { accept: false };
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
    const scored = hand.map(c => ({ id: c.id, score: discardScore(c) }));
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, excess).map(s => s.id);
  }

  getNetwork(): PolicyNetwork {
    return this.network;
  }
}

function discardScore(card: AnyCard): number {
  if (card.type === 'money') return card.value;
  if (card.type === 'action' && card.actionType === 'just_say_no') return 100;
  if (card.type === 'action' && card.actionType === 'deal_breaker') return 80;
  if (card.type === 'property') return 60;
  if (card.type === 'property_wildcard') return 50;
  return card.value + 10;
}

function smartPayment(me: { bank: AnyCard[]; propertySets: { cards: AnyCard[]; isComplete: boolean }[] }, amount: number): string[] {
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
  if (selected.length === 0 && me.bank.length > 0) {
    selected.push(me.bank[0].id);
  }
  return selected;
}
