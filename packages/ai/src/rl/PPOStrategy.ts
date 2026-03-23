import type { GameState, AnyCard, PendingAction, Player, PropertyColor } from '@monopoly-deal/shared';
import type { AIStrategy, AIAction, AIResponse } from '../../../server/src/game/ai/types.js';
import { PPONetwork } from './PPONetwork.js';
import { encodeState, type PaymentContext } from './FeatureEncoder.js';
import {
  enumeratePlayActions, enumerateResponseActions, enumerateDiscardActions,
  enumeratePaymentActions, enumerateRearrangeActions, buildPayableCardPool,
  buildValidMask, sortHand, type ActionCandidate,
} from './ActionSpace.js';

export interface PPOStepRecord {
  actionIdx: number;
  logProb: number;
  value: number;
  entropy: number;
  input: Float32Array;
  validMask: boolean[];
}

export class PPOStrategy implements AIStrategy {
  private network: PPONetwork;
  private explore: boolean;
  private discardPile: AnyCard[] = [];
  public lastStep: PPOStepRecord | null = null;

  constructor(network: PPONetwork, explore = false) {
    this.network = network;
    this.explore = explore;
  }

  setDiscardPile(pile: AnyCard[]): void {
    this.discardPile = pile;
  }

  chooseAction(state: GameState, hand: AnyCard[], myId: string): AIAction | null {
    if (hand.length === 0) return { type: 'end-turn' };

    const features = encodeState(state, hand, myId, undefined, this.discardPile);
    const candidates = enumeratePlayActions(state, hand, myId);

    if (candidates.length <= 1) {
      this.lastStep = null;
      return candidates[0]?.action as AIAction ?? { type: 'end-turn' };
    }

    const mask = buildValidMask(candidates);
    const { probs, value } = this.network.forward(features, mask, this.explore);

    const chosenIdx = this.pickAction(probs, candidates);
    const chosen = candidates.find(c => c.index === chosenIdx);
    const logProb = Math.log(Math.max(probs[chosenIdx], 1e-10));
    const entropy = this.network.entropy(probs);

    this.lastStep = {
      actionIdx: chosenIdx,
      logProb,
      value,
      entropy,
      input: Float32Array.from(features),
      validMask: [...mask],
    };

    if (!chosen) return { type: 'end-turn' };
    const action = chosen.action;
    if (action.type === 'end-turn' || action.type === 'play-card') return action;
    return { type: 'end-turn' };
  }

  chooseResponse(state: GameState, hand: AnyCard[], myId: string, pending: PendingAction): AIResponse {
    const me = state.players.find(p => p.id === myId);
    if (!me) return { accept: true, paymentCardIds: [] };

    const features = encodeState(state, hand, myId, undefined, this.discardPile);
    const candidates = enumerateResponseActions(hand, pending);

    if (candidates.length <= 1) {
      this.lastStep = null;
      if (pending.type === 'deal_breaker' || pending.type === 'sly_deal' || pending.type === 'forced_deal') {
        return { accept: true, paymentCardIds: [] };
      }
      return this.buildPaymentResponse(state, hand, myId, me, pending);
    }

    const mask = buildValidMask(candidates);
    const { probs, value } = this.network.forward(features, mask, this.explore);

    const chosenIdx = this.pickAction(probs, candidates);
    const chosen = candidates.find(c => c.index === chosenIdx);
    const logProb = Math.log(Math.max(probs[chosenIdx], 1e-10));
    const entropy = this.network.entropy(probs);

    this.lastStep = {
      actionIdx: chosenIdx,
      logProb,
      value,
      entropy,
      input: Float32Array.from(features),
      validMask: [...mask],
    };

    if (chosen?.action.type === 'respond-reject') {
      return { accept: false };
    }
    if (pending.type === 'deal_breaker' || pending.type === 'sly_deal' || pending.type === 'forced_deal') {
      return { accept: true, paymentCardIds: [] };
    }
    return this.buildPaymentResponse(state, hand, myId, me, pending);
  }

  /**
   * Iteratively pick payment cards through the network.
   * Used for non-training scenarios (evaluation, live play).
   * The trainer calls chooseOnePayment() directly for per-step transitions.
   */
  private buildPaymentResponse(
    state: GameState, hand: AnyCard[], myId: string,
    me: Player, pending: PendingAction,
  ): AIResponse {
    const amount = pending.amount ?? 0;
    if (amount === 0) return { accept: true, paymentCardIds: [] };

    const selectedIds: string[] = [];
    const excludeIds = new Set<string>();
    let paidSoFar = 0;

    const pool = buildPayableCardPool(me);
    for (let iter = 0; iter < 15 && paidSoFar < amount; iter++) {
      const payCtx: PaymentContext = { amountOwed: amount, amountPaidSoFar: paidSoFar };
      const features = encodeState(state, hand, myId, payCtx, this.discardPile);
      const candidates = enumeratePaymentActions(me, amount, paidSoFar, excludeIds);

      if (candidates.length === 0) break;
      if (candidates.length === 1 && candidates[0].action.type === 'finish-payment') break;

      const mask = buildValidMask(candidates);
      const { probs } = this.network.forward(features, mask, this.explore);
      const chosenIdx = this.pickAction(probs, candidates);
      const chosen = candidates.find(c => c.index === chosenIdx);

      if (!chosen || chosen.action.type === 'finish-payment') break;
      if (chosen.action.type === 'pay') {
        selectedIds.push(chosen.action.cardId);
        excludeIds.add(chosen.action.cardId);
        const card = pool.find(c => c.id === chosen.action.cardId);
        if (card) paidSoFar += card.value;
      }
    }

    if (selectedIds.length === 0 && me.bank.length > 0) {
      selectedIds.push(me.bank[0].id);
    }
    return { accept: true, paymentCardIds: selectedIds };
  }

  /**
   * Single-card payment decision through the network.
   * Called by the trainer for each card in the payment loop.
   */
  chooseOnePayment(
    state: GameState, hand: AnyCard[], myId: string,
    me: Player, amountOwed: number, amountPaidSoFar: number, excludeIds: Set<string>,
  ): { cardId: string | null; finished: boolean } {
    const payCtx: PaymentContext = { amountOwed, amountPaidSoFar };
    const features = encodeState(state, hand, myId, payCtx, this.discardPile);
    const candidates = enumeratePaymentActions(me, amountOwed, amountPaidSoFar, excludeIds);

    if (candidates.length === 0) {
      this.lastStep = null;
      return { cardId: null, finished: true };
    }

    if (candidates.length === 1) {
      const only = candidates[0];
      this.lastStep = null;
      if (only.action.type === 'finish-payment') return { cardId: null, finished: true };
      if (only.action.type === 'pay') return { cardId: only.action.cardId, finished: false };
      return { cardId: null, finished: true };
    }

    const mask = buildValidMask(candidates);
    const { probs, value } = this.network.forward(features, mask, this.explore);

    const chosenIdx = this.pickAction(probs, candidates);
    const chosen = candidates.find(c => c.index === chosenIdx);
    const logProb = Math.log(Math.max(probs[chosenIdx], 1e-10));
    const entropy = this.network.entropy(probs);

    this.lastStep = {
      actionIdx: chosenIdx,
      logProb,
      value,
      entropy,
      input: Float32Array.from(features),
      validMask: [...mask],
    };

    if (!chosen || chosen.action.type === 'finish-payment') return { cardId: null, finished: true };
    if (chosen.action.type === 'pay') return { cardId: chosen.action.cardId, finished: false };
    return { cardId: null, finished: true };
  }

  chooseOneRearrange(
    state: GameState, hand: AnyCard[], myId: string,
  ): { cardId: string; toColor: PropertyColor } | null {
    const me = state.players.find(p => p.id === myId);
    if (!me) { this.lastStep = null; return null; }

    const candidates = enumerateRearrangeActions(me);
    if (candidates.length <= 1) {
      this.lastStep = null;
      return null;
    }

    const features = encodeState(state, hand, myId, undefined, this.discardPile);
    const mask = buildValidMask(candidates);
    const { probs, value } = this.network.forward(features, mask, this.explore);

    const chosenIdx = this.pickAction(probs, candidates);
    const chosen = candidates.find(c => c.index === chosenIdx);
    const logProb = Math.log(Math.max(probs[chosenIdx], 1e-10));
    const entropy = this.network.entropy(probs);

    this.lastStep = {
      actionIdx: chosenIdx,
      logProb,
      value,
      entropy,
      input: Float32Array.from(features),
      validMask: [...mask],
    };

    if (!chosen || chosen.action.type === 'skip-rearrange') return null;
    if (chosen.action.type === 'rearrange') {
      return { cardId: chosen.action.cardId, toColor: chosen.action.toColor };
    }
    return null;
  }

  chooseDiscard(hand: AnyCard[]): string[] {
    this.lastStep = null;
    const excess = hand.length - 7;
    if (excess <= 0) return [];

    // For discard, we can't easily get the full state here.
    // The trainer game loop will handle discard decisions one at a time.
    // This fallback handles non-training scenarios (evaluation, live play).
    const scored = hand.map(c => ({ id: c.id, score: discardScore(c) }));
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, excess).map(s => s.id);
  }

  /**
   * Single-card discard decision through the network.
   * Called by the trainer for each card that needs to be discarded.
   */
  chooseOneDiscard(state: GameState, hand: AnyCard[], myId: string): string {
    const features = encodeState(state, hand, myId, undefined, this.discardPile);
    const candidates = enumerateDiscardActions(hand);

    if (candidates.length <= 1) {
      this.lastStep = null;
      return candidates[0] ? (candidates[0].action as { type: 'discard'; cardId: string }).cardId : hand[0].id;
    }

    const mask = buildValidMask(candidates);
    const { probs, value } = this.network.forward(features, mask, this.explore);

    const chosenIdx = this.pickAction(probs, candidates);
    const chosen = candidates.find(c => c.index === chosenIdx);
    const logProb = Math.log(Math.max(probs[chosenIdx], 1e-10));
    const entropy = this.network.entropy(probs);

    this.lastStep = {
      actionIdx: chosenIdx,
      logProb,
      value,
      entropy,
      input: Float32Array.from(features),
      validMask: [...mask],
    };

    if (chosen && chosen.action.type === 'discard') {
      return chosen.action.cardId;
    }
    return hand[0].id;
  }

  getNetwork(): PPONetwork {
    return this.network;
  }

  private pickAction(probs: Float32Array, candidates: ActionCandidate[]): number {
    if (this.explore) {
      return this.network.sampleAction(probs);
    }
    let bestIdx = 0;
    let bestP = -1;
    for (const c of candidates) {
      if (probs[c.index] > bestP) { bestP = probs[c.index]; bestIdx = c.index; }
    }
    return bestIdx;
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
