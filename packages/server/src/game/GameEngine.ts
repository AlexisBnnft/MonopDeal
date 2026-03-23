import {
  SET_SIZE, RENT_VALUES,
  type AnyCard, type PropertyColor, type Player, type PropertySet,
  type GameState, type PendingAction, type TurnPhase, type WildcardCard,
  type ActionType, type JsnChain,
} from '@monopoly-deal/shared';
import { buildDeck, shuffleDeck } from './deck.js';

interface PlayCardOpts {
  asMoney?: boolean;
  color?: PropertyColor;
  targetPlayerId?: string;
  targetCardId?: string;
  offeredCardId?: string;
  targetSetColor?: PropertyColor;
  doubleTheRentCardIds?: string[];
}

export class GameEngine {
  private drawPile: AnyCard[] = [];
  private discardPile: AnyCard[] = [];
  private hands: Map<string, AnyCard[]> = new Map();
  private banks: Map<string, AnyCard[]> = new Map();
  private properties: Map<string, PropertySet[]> = new Map();
  private playerOrder: string[] = [];
  private playerNames: Map<string, string> = new Map();
  private playerConnected: Map<string, boolean> = new Map();
  private currentPlayerIndex = 0;
  private actionsRemaining = 3;
  private turnPhase: TurnPhase = 'draw';
  private turnNumber = 1;
  private winnerId?: string;
  private pendingAction: PendingAction | null = null;
  private lastAction?: string;

  constructor(players: { id: string; name: string }[]) {
    this.drawPile = shuffleDeck(buildDeck());
    this.playerOrder = players.map(p => p.id);

    for (const p of players) {
      this.playerNames.set(p.id, p.name);
      this.playerConnected.set(p.id, true);
      this.hands.set(p.id, []);
      this.banks.set(p.id, []);
      this.properties.set(p.id, []);
    }

    for (const p of players) {
      for (let i = 0; i < 5; i++) {
        this.drawCard(p.id, false);
      }
    }

    this.autoDrawCurrentPlayer();
  }

  // ─── Core Actions ───────────────────────────────────────────────────

  draw(playerId: string): { error?: string } {
    if (this.winnerId) return { error: 'Game is over' };
    if (this.pendingAction) return { error: 'Pending action must be resolved first' };
    if (this.playerOrder[this.currentPlayerIndex] !== playerId) return { error: 'Not your turn' };
    // Auto-draw makes this a no-op; kept for backward compatibility
    if (this.turnPhase !== 'draw') return {};
    this.autoDrawCurrentPlayer();
    return {};
  }

  playCard(playerId: string, cardId: string, opts: PlayCardOpts = {}): { error?: string } {
    if (this.winnerId) return { error: 'Game is over' };
    if (this.pendingAction) return { error: 'Pending action must be resolved first' };
    if (this.playerOrder[this.currentPlayerIndex] !== playerId) return { error: 'Not your turn' };
    if (this.turnPhase !== 'action') return { error: 'Draw cards first' };
    if (this.actionsRemaining <= 0) return { error: 'No actions remaining' };

    const hand = this.hands.get(playerId)!;
    const cardIndex = hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return { error: 'Card not in hand' };
    const card = hand[cardIndex];

    // Fix 4: property cards cannot be banked
    if (opts.asMoney) {
      if (card.type === 'property' || card.type === 'property_wildcard') {
        return { error: 'Property cards cannot be banked' };
      }
      hand.splice(cardIndex, 1);
      this.banks.get(playerId)!.push(card);
      this.actionsRemaining--;
      this.lastAction = `${this.getName(playerId)} banked ${card.name} ($${card.value}M)`;
      this.checkEndTurn(playerId);
      return {};
    }

    switch (card.type) {
      case 'money':
        hand.splice(cardIndex, 1);
        this.banks.get(playerId)!.push(card);
        this.actionsRemaining--;
        this.lastAction = `${this.getName(playerId)} banked $${card.value}M`;
        break;

      case 'property':
        hand.splice(cardIndex, 1);
        this.addPropertyToSets(playerId, card, card.color);
        this.actionsRemaining--;
        this.lastAction = `${this.getName(playerId)} played ${card.name}`;
        this.checkWin(playerId);
        break;

      case 'property_wildcard': {
        const wc = card as WildcardCard;
        const color = opts.color || wc.currentColor;
        if (wc.colors !== 'all' && !wc.colors.includes(color)) {
          return { error: `Invalid color for this wildcard` };
        }
        wc.currentColor = color;
        hand.splice(cardIndex, 1);
        this.addPropertyToSets(playerId, wc, color);
        this.actionsRemaining--;
        this.lastAction = `${this.getName(playerId)} played ${wc.name} as ${color}`;
        this.checkWin(playerId);
        break;
      }

      case 'action':
        return this.playAction(playerId, cardIndex, card, opts);

      case 'rent':
        return this.playRent(playerId, cardIndex, card, opts);
    }

    this.checkEndTurn(playerId);
    return {};
  }

  endTurn(playerId: string): { error?: string } {
    if (this.winnerId) return { error: 'Game is over' };
    if (this.pendingAction) return { error: 'Pending action must be resolved first' };
    if (this.playerOrder[this.currentPlayerIndex] !== playerId) return { error: 'Not your turn' };
    if (this.turnPhase === 'draw') return { error: 'Must draw cards first' };

    const hand = this.hands.get(playerId)!;
    if (hand.length > 7) {
      this.turnPhase = 'discard';
      this.lastAction = `${this.getName(playerId)} must discard ${hand.length - 7} card(s)`;
      return {};
    }

    this.advanceTurn();
    return {};
  }

  discard(playerId: string, cardIds: string[]): { error?: string } {
    if (this.playerOrder[this.currentPlayerIndex] !== playerId) return { error: 'Not your turn' };
    if (this.turnPhase !== 'discard') return { error: 'Not in discard phase' };

    const hand = this.hands.get(playerId)!;
    for (const id of cardIds) {
      const idx = hand.findIndex(c => c.id === id);
      if (idx === -1) return { error: `Card ${id} not in hand` };
      const [card] = hand.splice(idx, 1);
      this.discardPile.push(card);
    }

    if (hand.length > 7) {
      this.lastAction = `${this.getName(playerId)} discarded ${cardIds.length} card(s), ${hand.length - 7} more to go`;
      return {};
    }

    this.lastAction = `${this.getName(playerId)} discarded ${cardIds.length} card(s)`;
    this.advanceTurn();
    return {};
  }

  // Fix 6: JSN chain + Fix 15: minimum payment enforcement
  respond(playerId: string, accept: boolean, paymentCardIds?: string[]): { error?: string } {
    if (!this.pendingAction) return { error: 'No pending action' };

    const pa = this.pendingAction;

    // Handle JSN chain counter-response
    if (pa.jsnChain && pa.jsnChain.awaitingCounterFrom === playerId) {
      if (!accept) {
        if (pa.jsnChain.actionCancelled) {
          const targetId = pa.jsnChain.lastPlayedBy;
          if (!pa.respondedPlayerIds.includes(targetId)) {
            pa.respondedPlayerIds.push(targetId);
          }
          pa.jsnChain = undefined;
          this.lastAction = `${this.getName(playerId)} declines to counter`;
          if (this.allTargetsResponded()) {
            this.pendingAction = null;
          }
        } else {
          pa.jsnChain = undefined;
          this.lastAction = `${this.getName(playerId)} declines to counter — action stands`;
        }
        return {};
      }

      const hand = this.hands.get(playerId)!;
      const jsnIdx = hand.findIndex(c => c.type === 'action' && c.actionType === 'just_say_no');
      if (jsnIdx === -1) return { error: 'You need a Just Say No card to counter' };
      const [jsnCard] = hand.splice(jsnIdx, 1);
      this.discardPile.push(jsnCard);

      pa.jsnChain = {
        lastPlayedBy: playerId,
        awaitingCounterFrom: pa.jsnChain.lastPlayedBy,
        actionCancelled: !pa.jsnChain.actionCancelled,
      };
      this.lastAction = `${this.getName(playerId)} countered with Just Say No!`;
      return {};
    }

    if (pa.jsnChain) return { error: 'Waiting for Just Say No chain to resolve' };
    if (!pa.targetPlayerIds.includes(playerId)) return { error: 'Not your action to respond to' };
    if (pa.respondedPlayerIds.includes(playerId)) return { error: 'Already responded' };

    // Just Say No — starts chain
    if (!accept) {
      const hand = this.hands.get(playerId)!;
      const jsn = hand.findIndex(c => c.type === 'action' && c.actionType === 'just_say_no');
      if (jsn === -1) return { error: 'You need a Just Say No card to refuse' };
      const [jsnCard] = hand.splice(jsn, 1);
      this.discardPile.push(jsnCard);

      pa.jsnChain = {
        lastPlayedBy: playerId,
        awaitingCounterFrom: pa.sourcePlayerId,
        actionCancelled: true,
      };
      this.lastAction = `${this.getName(playerId)} said Just Say No!`;
      return {};
    }

    // Accept the action
    switch (pa.type) {
      case 'rent':
      case 'debt_collector':
      case 'its_my_birthday': {
        if (!paymentCardIds || paymentCardIds.length === 0) {
          const total = this.getPlayerTotalValue(playerId);
          if (total === 0) {
            pa.respondedPlayerIds.push(playerId);
            this.lastAction = `${this.getName(playerId)} has nothing to pay`;
            break;
          }
          return { error: 'Must select cards to pay with' };
        }

        // Fix 15: validate minimum payment
        const paymentValue = this.calculateCardValues(playerId, paymentCardIds);
        if (paymentValue.error) return paymentValue;
        const totalOnTable = this.getPlayerTotalValue(playerId);
        if (paymentValue.total! < pa.amount! && paymentValue.total! < totalOnTable) {
          return { error: 'You must pay as much as you can' };
        }

        const result = this.processPayment(playerId, pa.sourcePlayerId, paymentCardIds, pa.amount!);
        if (result.error) return result;
        pa.respondedPlayerIds.push(playerId);
        this.lastAction = `${this.getName(playerId)} paid $${result.paid}M`;
        this.checkWin(pa.sourcePlayerId);
        break;
      }

      case 'deal_breaker': {
        const targetSets = this.properties.get(playerId)!;
        const setIdx = targetSets.findIndex(s => s.color === pa.targetSetColor && s.isComplete);
        if (setIdx === -1) return { error: 'Set not found' };
        const [stolen] = targetSets.splice(setIdx, 1);
        this.properties.get(pa.sourcePlayerId)!.push(stolen);
        pa.respondedPlayerIds.push(playerId);
        this.lastAction = `${this.getName(pa.sourcePlayerId)} stole ${this.getName(playerId)}'s ${pa.targetSetColor} set!`;
        this.checkWin(pa.sourcePlayerId);
        break;
      }

      case 'sly_deal': {
        const stolen = this.removePropertyCard(playerId, pa.targetCardId!);
        if (!stolen) return { error: 'Card not found in properties' };
        const color = stolen.type === 'property' ? stolen.color
          : (stolen as WildcardCard).currentColor;
        this.addPropertyToSets(pa.sourcePlayerId, stolen, color);
        pa.respondedPlayerIds.push(playerId);
        this.lastAction = `${this.getName(pa.sourcePlayerId)} stole ${stolen.name} from ${this.getName(playerId)}`;
        this.checkWin(pa.sourcePlayerId);
        break;
      }

      case 'forced_deal': {
        const stolen = this.removePropertyCard(playerId, pa.requestedCardId!);
        if (!stolen) return { error: 'Requested card not found' };
        const given = this.removePropertyCard(pa.sourcePlayerId, pa.offeredCardId!);
        if (!given) return { error: 'Offered card not found' };

        const stolenColor = stolen.type === 'property' ? stolen.color
          : (stolen as WildcardCard).currentColor;
        const givenColor = given.type === 'property' ? given.color
          : (given as WildcardCard).currentColor;

        this.addPropertyToSets(pa.sourcePlayerId, stolen, stolenColor);
        this.addPropertyToSets(playerId, given, givenColor);
        pa.respondedPlayerIds.push(playerId);
        this.lastAction = `${this.getName(pa.sourcePlayerId)} swapped properties with ${this.getName(playerId)}`;
        this.checkWin(pa.sourcePlayerId);
        break;
      }
    }

    if (this.allTargetsResponded()) {
      this.pendingAction = null;
    }

    return {};
  }

  // Fix 10: rearrange wildcards between sets (free, no action cost)
  rearrange(playerId: string, cardId: string, toColor: PropertyColor): { error?: string } {
    if (this.winnerId) return { error: 'Game is over' };
    if (this.playerOrder[this.currentPlayerIndex] !== playerId) return { error: 'Not your turn' };
    if (this.turnPhase !== 'action' && this.turnPhase !== 'draw') return { error: 'Can only rearrange during your turn' };

    const sets = this.properties.get(playerId)!;
    let sourceSet: PropertySet | undefined;
    let cardIdx = -1;

    for (const s of sets) {
      const idx = s.cards.findIndex(c => c.id === cardId);
      if (idx !== -1) { sourceSet = s; cardIdx = idx; break; }
    }

    if (!sourceSet || cardIdx === -1) return { error: 'Card not found in your properties' };
    const card = sourceSet.cards[cardIdx];
    if (card.type !== 'property_wildcard') return { error: 'Only wildcards can be rearranged' };
    const wc = card as WildcardCard;
    if (wc.colors !== 'all' && !wc.colors.includes(toColor)) return { error: 'Invalid color for this wildcard' };
    if (sourceSet.color === toColor) return { error: 'Already in that color set' };

    sourceSet.cards.splice(cardIdx, 1);
    const srcPropCount = sourceSet.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length;
    sourceSet.isComplete = srcPropCount >= SET_SIZE[sourceSet.color];
    if (!sourceSet.isComplete) { sourceSet.hasHouse = false; sourceSet.hasHotel = false; }
    if (sourceSet.cards.length === 0) {
      const idx = sets.indexOf(sourceSet);
      if (idx !== -1) sets.splice(idx, 1);
    }

    wc.currentColor = toColor;
    this.addPropertyToSets(playerId, wc, toColor);
    this.lastAction = `${this.getName(playerId)} rearranged ${wc.name} to ${toColor}`;
    this.checkWin(playerId);
    return {};
  }

  // ─── Action Card Logic ──────────────────────────────────────────────

  private playAction(playerId: string, cardIndex: number, card: AnyCard & { actionType: ActionType }, opts: PlayCardOpts): { error?: string } {
    const hand = this.hands.get(playerId)!;

    switch (card.actionType) {
      case 'pass_go':
        hand.splice(cardIndex, 1);
        this.discardPile.push(card);
        this.drawCards(playerId, 2);
        this.actionsRemaining--;
        this.lastAction = `${this.getName(playerId)} played Pass Go`;
        break;

      case 'debt_collector': {
        if (!opts.targetPlayerId) return { error: 'Must select a target player' };
        hand.splice(cardIndex, 1);
        this.discardPile.push(card);
        this.actionsRemaining--;
        this.pendingAction = {
          type: 'debt_collector', sourcePlayerId: playerId,
          targetPlayerIds: [opts.targetPlayerId], amount: 5, respondedPlayerIds: [],
        };
        this.lastAction = `${this.getName(playerId)} demands $5M from ${this.getName(opts.targetPlayerId)}`;
        break;
      }

      case 'its_my_birthday': {
        hand.splice(cardIndex, 1);
        this.discardPile.push(card);
        this.actionsRemaining--;
        const others = this.playerOrder.filter(id => id !== playerId);
        this.pendingAction = {
          type: 'its_my_birthday', sourcePlayerId: playerId,
          targetPlayerIds: others, amount: 2, respondedPlayerIds: [],
        };
        this.lastAction = `${this.getName(playerId)} says It's My Birthday! ($2M from everyone)`;
        break;
      }

      case 'deal_breaker': {
        if (!opts.targetPlayerId || !opts.targetSetColor) return { error: 'Must select target player and set color' };
        const targetSets = this.properties.get(opts.targetPlayerId)!;
        const hasComplete = targetSets.some(s => s.color === opts.targetSetColor && s.isComplete);
        if (!hasComplete) return { error: 'Target has no complete set of that color' };
        hand.splice(cardIndex, 1);
        this.discardPile.push(card);
        this.actionsRemaining--;
        this.pendingAction = {
          type: 'deal_breaker', sourcePlayerId: playerId,
          targetPlayerIds: [opts.targetPlayerId], targetSetColor: opts.targetSetColor, respondedPlayerIds: [],
        };
        this.lastAction = `${this.getName(playerId)} played Deal Breaker on ${this.getName(opts.targetPlayerId)}'s ${opts.targetSetColor} set!`;
        break;
      }

      case 'sly_deal': {
        if (!opts.targetPlayerId || !opts.targetCardId) return { error: 'Must select target player and card' };
        const targetSets = this.properties.get(opts.targetPlayerId)!;
        const targetSet = targetSets.find(s => s.cards.some(c => c.id === opts.targetCardId));
        if (!targetSet) return { error: 'Card not found in target properties' };
        if (targetSet.isComplete) return { error: "Can't steal from a complete set" };
        // Fix 14: validate card type
        const targetCard = targetSet.cards.find(c => c.id === opts.targetCardId)!;
        if (targetCard.type !== 'property' && targetCard.type !== 'property_wildcard') {
          return { error: 'Can only steal property cards' };
        }
        hand.splice(cardIndex, 1);
        this.discardPile.push(card);
        this.actionsRemaining--;
        this.pendingAction = {
          type: 'sly_deal', sourcePlayerId: playerId,
          targetPlayerIds: [opts.targetPlayerId], targetCardId: opts.targetCardId, respondedPlayerIds: [],
        };
        this.lastAction = `${this.getName(playerId)} played Sly Deal on ${this.getName(opts.targetPlayerId)}`;
        break;
      }

      case 'forced_deal': {
        if (!opts.targetPlayerId || !opts.targetCardId || !opts.offeredCardId) {
          return { error: 'Must select target player, their card, and your offered card' };
        }
        const tSets = this.properties.get(opts.targetPlayerId)!;
        const tSet = tSets.find(s => s.cards.some(c => c.id === opts.targetCardId));
        if (!tSet) return { error: 'Card not found in target properties' };
        if (tSet.isComplete) return { error: "Can't swap from a complete set" };
        // Fix 14: validate target card type
        const tCard = tSet.cards.find(c => c.id === opts.targetCardId)!;
        if (tCard.type !== 'property' && tCard.type !== 'property_wildcard') {
          return { error: 'Can only swap property cards' };
        }
        // Fix 13: validate source card not in complete set
        const mySets = this.properties.get(playerId)!;
        const mySet = mySets.find(s => s.cards.some(c => c.id === opts.offeredCardId));
        if (!mySet) return { error: 'Offered card not found in your properties' };
        if (mySet.isComplete) return { error: "Can't swap from your complete set" };
        const myCard = mySet.cards.find(c => c.id === opts.offeredCardId)!;
        if (myCard.type !== 'property' && myCard.type !== 'property_wildcard') {
          return { error: 'Can only swap property cards' };
        }
        hand.splice(cardIndex, 1);
        this.discardPile.push(card);
        this.actionsRemaining--;
        this.pendingAction = {
          type: 'forced_deal', sourcePlayerId: playerId,
          targetPlayerIds: [opts.targetPlayerId], offeredCardId: opts.offeredCardId,
          requestedCardId: opts.targetCardId, respondedPlayerIds: [],
        };
        this.lastAction = `${this.getName(playerId)} played Forced Deal on ${this.getName(opts.targetPlayerId)}`;
        break;
      }

      // Fix 5: block house/hotel on railroad/utility
      case 'house': {
        if (!opts.color) return { error: 'Must select which set to add house to' };
        if (opts.color === 'railroad' || opts.color === 'utility') {
          return { error: 'Cannot place House on Railroad or Utility sets' };
        }
        const sets = this.properties.get(playerId)!;
        const set = sets.find(s => s.color === opts.color && s.isComplete && !s.hasHouse);
        if (!set) return { error: 'Need a complete set without a house' };
        hand.splice(cardIndex, 1);
        set.hasHouse = true;
        set.cards.push(card);
        this.actionsRemaining--;
        this.lastAction = `${this.getName(playerId)} added a House to ${opts.color}`;
        break;
      }

      case 'hotel': {
        if (!opts.color) return { error: 'Must select which set to add hotel to' };
        if (opts.color === 'railroad' || opts.color === 'utility') {
          return { error: 'Cannot place Hotel on Railroad or Utility sets' };
        }
        const sets = this.properties.get(playerId)!;
        const set = sets.find(s => s.color === opts.color && s.isComplete && s.hasHouse && !s.hasHotel);
        if (!set) return { error: 'Need a complete set with a house' };
        hand.splice(cardIndex, 1);
        set.hasHotel = true;
        set.cards.push(card);
        this.actionsRemaining--;
        this.lastAction = `${this.getName(playerId)} added a Hotel to ${opts.color}`;
        break;
      }

      case 'double_the_rent':
        return { error: 'Double the Rent must be played alongside a Rent card' };

      case 'just_say_no':
        return { error: 'Just Say No can only be used in response to actions against you (or bank it as money)' };
    }

    this.checkEndTurn(playerId);
    return {};
  }

  // Fix 9: DTR player-controlled + Fix 11: validation before card removal
  private playRent(playerId: string, cardIndex: number, card: AnyCard & { colors: [PropertyColor, PropertyColor] | 'all' }, opts: PlayCardOpts): { error?: string } {
    const hand = this.hands.get(playerId)!;
    const color = opts.color;
    if (!color) return { error: 'Must select a color for rent' };

    if (card.colors !== 'all' && !card.colors.includes(color)) {
      return { error: `This rent card can't be used for ${color}` };
    }

    // Fix 11: validate wild rent target BEFORE card removal
    if (card.colors === 'all' && !opts.targetPlayerId) {
      return { error: 'Wild rent requires selecting a target player' };
    }

    const sets = this.properties.get(playerId)!;
    const set = sets.find(s => s.color === color);
    if (!set || set.cards.length === 0) return { error: `You have no ${color} properties` };

    const propertyCount = set.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length;
    const rentIndex = Math.min(propertyCount, RENT_VALUES[color].length) - 1;
    let baseRent = RENT_VALUES[color][rentIndex] || 0;
    if (set.hasHouse) baseRent += 3;
    if (set.hasHotel) baseRent += 4;

    // Fix 9: explicit DTR choice
    const dtrIds = opts.doubleTheRentCardIds || [];
    const totalActions = 1 + dtrIds.length;
    if (totalActions > this.actionsRemaining) {
      return { error: `Not enough actions: need ${totalActions}, have ${this.actionsRemaining}` };
    }
    for (const dtrId of dtrIds) {
      const dtrCard = hand.find(c => c.id === dtrId && c.type === 'action' && c.actionType === 'double_the_rent');
      if (!dtrCard) return { error: 'Double the Rent card not found in hand' };
    }

    // All validation passed — remove cards
    hand.splice(cardIndex, 1);
    this.discardPile.push(card);
    for (const dtrId of dtrIds) {
      const dtrIdx = hand.findIndex(c => c.id === dtrId);
      if (dtrIdx !== -1) {
        const [dtrCard] = hand.splice(dtrIdx, 1);
        this.discardPile.push(dtrCard);
      }
    }

    const multiplier = Math.pow(2, dtrIds.length);
    const rentAmount = baseRent * multiplier;
    this.actionsRemaining -= totalActions;

    if (dtrIds.length > 0) {
      this.lastAction = `${this.getName(playerId)} charged ${multiplier}x rent: $${rentAmount}M for ${color}!`;
    } else {
      this.lastAction = `${this.getName(playerId)} charged $${rentAmount}M rent for ${color}`;
    }

    const targetIds = card.colors === 'all' && opts.targetPlayerId
      ? [opts.targetPlayerId]
      : this.playerOrder.filter(id => id !== playerId);

    this.pendingAction = {
      type: 'rent', sourcePlayerId: playerId,
      targetPlayerIds: targetIds, amount: rentAmount, baseAmount: baseRent, respondedPlayerIds: [],
    };

    this.checkEndTurn(playerId);
    return {};
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private drawCard(playerId: string, reshuffleIfEmpty = true): boolean {
    if (this.drawPile.length === 0) {
      if (!reshuffleIfEmpty || this.discardPile.length === 0) return false;
      this.drawPile = shuffleDeck([...this.discardPile]);
      this.discardPile = [];
    }
    const card = this.drawPile.pop()!;
    this.hands.get(playerId)!.push(card);
    return true;
  }

  private drawCards(playerId: string, count: number): number {
    let drawn = 0;
    for (let i = 0; i < count; i++) {
      if (this.drawCard(playerId)) drawn++;
    }
    return drawn;
  }

  private addPropertyToSets(playerId: string, card: AnyCard, color: PropertyColor) {
    const sets = this.properties.get(playerId)!;
    let set = sets.find(s => s.color === color && !s.isComplete);
    if (!set) {
      set = { color, cards: [], hasHouse: false, hasHotel: false, isComplete: false };
      sets.push(set);
    }
    set.cards.push(card);
    const propCount = set.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length;
    set.isComplete = propCount >= SET_SIZE[color];
  }

  // Fix 8: orphaned house/hotel stay on table
  private removePropertyCard(playerId: string, cardId: string): AnyCard | null {
    const sets = this.properties.get(playerId)!;
    for (let i = 0; i < sets.length; i++) {
      const cardIdx = sets[i].cards.findIndex(c => c.id === cardId);
      if (cardIdx !== -1) {
        const [card] = sets[i].cards.splice(cardIdx, 1);
        const propCount = sets[i].cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length;
        sets[i].isComplete = propCount >= SET_SIZE[sets[i].color];
        if (!sets[i].isComplete) {
          sets[i].hasHouse = false;
          sets[i].hasHotel = false;
        }
        if (sets[i].cards.length === 0) {
          sets.splice(i, 1);
        }
        return card;
      }
    }
    return null;
  }

  // Fix 7: property payments -> property area + Fix 12: block multicolor wildcard payment
  private processPayment(fromId: string, toId: string, cardIds: string[], amount: number): { error?: string; paid?: number } {
    let paid = 0;
    const fromBank = this.banks.get(fromId)!;
    const toBank = this.banks.get(toId)!;

    for (const id of cardIds) {
      const idx = fromBank.findIndex(c => c.id === id);
      if (idx !== -1) {
        const [card] = fromBank.splice(idx, 1);
        toBank.push(card);
        paid += card.value;
        continue;
      }

      // Check for multicolor wildcard before removing
      const propSets = this.properties.get(fromId)!;
      let foundInProps = false;
      for (const s of propSets) {
        const cIdx = s.cards.findIndex(c => c.id === id);
        if (cIdx !== -1) {
          const c = s.cards[cIdx];
          if (c.type === 'property_wildcard' && (c as WildcardCard).colors === 'all') {
            return { error: 'Multicolor wildcards cannot be used for payment' };
          }
          foundInProps = true;
          break;
        }
      }

      if (foundInProps) {
        const card = this.removePropertyCard(fromId, id);
        if (card) {
          if (card.type === 'property' || card.type === 'property_wildcard') {
            const color = card.type === 'property' ? card.color : (card as WildcardCard).currentColor;
            this.addPropertyToSets(toId, card, color);
          } else {
            toBank.push(card);
          }
          paid += card.value;
          continue;
        }
      }

      return { error: `Card ${id} not found in your bank or properties` };
    }
    return { paid };
  }

  private calculateCardValues(playerId: string, cardIds: string[]): { error?: string; total?: number } {
    let total = 0;
    const bank = this.banks.get(playerId)!;
    const sets = this.properties.get(playerId)!;
    for (const id of cardIds) {
      const bankCard = bank.find(c => c.id === id);
      if (bankCard) { total += bankCard.value; continue; }
      let found = false;
      for (const s of sets) {
        const c = s.cards.find(c => c.id === id);
        if (c) {
          if (c.type === 'property_wildcard' && (c as WildcardCard).colors === 'all') {
            return { error: 'Multicolor wildcards cannot be used for payment' };
          }
          total += c.value;
          found = true;
          break;
        }
      }
      if (!found) return { error: `Card ${id} not found` };
    }
    return { total };
  }

  private getPlayerTotalValue(playerId: string): number {
    let total = 0;
    for (const card of this.banks.get(playerId)!) total += card.value;
    for (const set of this.properties.get(playerId)!) {
      for (const card of set.cards) {
        if (card.type === 'property_wildcard' && (card as WildcardCard).colors === 'all') continue;
        total += card.value;
      }
    }
    return total;
  }

  private getName(playerId: string): string {
    return this.playerNames.get(playerId) || playerId.slice(0, 6);
  }

  // Fix 3: count total complete sets, not unique colors
  private checkWin(playerId: string) {
    const sets = this.properties.get(playerId)!;
    const completeSets = sets.filter(s => s.isComplete);
    if (completeSets.length >= 3) {
      this.winnerId = playerId;
      this.lastAction = `${this.getName(playerId)} WINS with ${completeSets.length} complete sets!`;
    }
  }

  private checkEndTurn(playerId: string) {
    if (this.actionsRemaining <= 0 && !this.pendingAction) {
      const hand = this.hands.get(playerId)!;
      if (hand.length > 7) this.turnPhase = 'discard';
    }
  }

  private allTargetsResponded(): boolean {
    if (!this.pendingAction) return true;
    return this.pendingAction.targetPlayerIds.every(
      id => this.pendingAction!.respondedPlayerIds.includes(id)
    );
  }

  private advanceTurn() {
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerOrder.length;
    let attempts = 0;
    while (!this.playerConnected.get(this.playerOrder[this.currentPlayerIndex]) && attempts < this.playerOrder.length) {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerOrder.length;
      attempts++;
    }
    this.turnNumber++;
    this.autoDrawCurrentPlayer();
  }

  private autoDrawCurrentPlayer() {
    const playerId = this.playerOrder[this.currentPlayerIndex];
    const handSize = this.hands.get(playerId)!.length;
    const drawCount = handSize === 0 ? 5 : 2;
    const drawn = this.drawCards(playerId, drawCount);
    this.turnPhase = 'action';
    this.actionsRemaining = 3;
    this.lastAction = `${this.getName(playerId)} drew ${drawn} cards`;
  }

  // ─── State Getters ──────────────────────────────────────────────────

  getHand(playerId: string): AnyCard[] {
    return this.hands.get(playerId) || [];
  }

  getState(): GameState {
    const players: Player[] = this.playerOrder.map(id => ({
      id,
      name: this.playerNames.get(id)!,
      handCount: this.hands.get(id)!.length,
      bank: this.banks.get(id)!,
      propertySets: this.properties.get(id)!,
      connected: this.playerConnected.get(id) ?? false,
    }));

    return {
      players,
      currentPlayerIndex: this.currentPlayerIndex,
      actionsRemaining: this.actionsRemaining,
      turnPhase: this.turnPhase,
      drawPileCount: this.drawPile.length,
      discardPile: this.discardPile.slice(-3),
      phase: this.winnerId ? 'finished' : 'playing',
      winnerId: this.winnerId,
      turnNumber: this.turnNumber,
      pendingAction: this.pendingAction,
      lastAction: this.lastAction,
    };
  }

  replacePlayerId(oldId: string, newId: string) {
    // Update playerOrder
    const idx = this.playerOrder.indexOf(oldId);
    if (idx !== -1) this.playerOrder[idx] = newId;

    // Swap all map entries
    const swapMap = <V>(map: Map<string, V>) => {
      if (map.has(oldId)) {
        map.set(newId, map.get(oldId)!);
        map.delete(oldId);
      }
    };
    swapMap(this.hands);
    swapMap(this.banks);
    swapMap(this.properties);
    swapMap(this.playerNames);
    swapMap(this.playerConnected);
    this.playerConnected.set(newId, true);

    // Update pendingAction references
    if (this.pendingAction) {
      const pa = this.pendingAction;
      if (pa.sourcePlayerId === oldId) pa.sourcePlayerId = newId;
      pa.targetPlayerIds = pa.targetPlayerIds.map(id => id === oldId ? newId : id);
      pa.respondedPlayerIds = pa.respondedPlayerIds.map(id => id === oldId ? newId : id);
      if (pa.jsnChain) {
        if (pa.jsnChain.lastPlayedBy === oldId) pa.jsnChain.lastPlayedBy = newId;
        if (pa.jsnChain.awaitingCounterFrom === oldId) pa.jsnChain.awaitingCounterFrom = newId;
      }
    }

    // Update winnerId
    if (this.winnerId === oldId) this.winnerId = newId;
  }

  /** Full discard pile (public info — face-up cards). Used for card counting. */
  getFullDiscardPile(): AnyCard[] {
    return [...this.discardPile];
  }

  setDisconnected(playerId: string) { this.playerConnected.set(playerId, false); }
  setConnected(playerId: string) { this.playerConnected.set(playerId, true); }
}

export { shuffleDeck } from './deck.js';
