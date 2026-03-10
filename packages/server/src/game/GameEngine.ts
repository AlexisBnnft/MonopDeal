import {
  SET_SIZE, RENT_VALUES,
  type AnyCard, type PropertyColor, type Player, type PropertySet,
  type GameState, type PendingAction, type TurnPhase, type WildcardCard,
  type ActionType,
} from '@monopoly-deal/shared';
import { buildDeck, shuffleDeck } from './deck.js';

interface PlayCardOpts {
  asMoney?: boolean;
  color?: PropertyColor;
  targetPlayerId?: string;
  targetCardId?: string;
  offeredCardId?: string;
  targetSetColor?: PropertyColor;
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

    // Deal 5 cards to each player
    for (const p of players) {
      for (let i = 0; i < 5; i++) {
        this.drawCard(p.id, false);
      }
    }

    this.turnPhase = 'draw';
  }

  // ─── Core Actions ───────────────────────────────────────────────────

  draw(playerId: string): { error?: string } {
    if (this.winnerId) return { error: 'Game is over' };
    if (this.pendingAction) return { error: 'Pending action must be resolved first' };
    if (this.playerOrder[this.currentPlayerIndex] !== playerId) return { error: 'Not your turn' };
    if (this.turnPhase !== 'draw') return { error: 'Already drew cards this turn' };

    const drawn = this.drawCards(playerId, 2);
    this.turnPhase = 'action';
    this.actionsRemaining = 3;
    this.lastAction = `${this.getName(playerId)} drew ${drawn} cards`;

    // If hand is empty at start of turn (edge case), they still draw
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

    // Any card can be banked as money
    if (opts.asMoney) {
      hand.splice(cardIndex, 1);
      this.banks.get(playerId)!.push(card);
      this.actionsRemaining--;
      this.lastAction = `${this.getName(playerId)} banked ${card.name} ($${card.value}M)`;
      this.checkEndTurn(playerId);
      return {};
    }

    switch (card.type) {
      case 'money':
        // Money can only be banked
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
      return { error: `Must discard down to 7 cards (you have ${hand.length})` };
    }

    this.advanceTurn();
    return {};
  }

  discard(playerId: string, cardIds: string[]): { error?: string } {
    if (this.playerOrder[this.currentPlayerIndex] !== playerId) return { error: 'Not your turn' };

    const hand = this.hands.get(playerId)!;
    for (const id of cardIds) {
      const idx = hand.findIndex(c => c.id === id);
      if (idx === -1) return { error: `Card ${id} not in hand` };
      const [card] = hand.splice(idx, 1);
      this.discardPile.push(card);
    }

    if (hand.length > 7) {
      return { error: `Still have ${hand.length} cards, need 7 or fewer` };
    }

    this.lastAction = `${this.getName(playerId)} discarded ${cardIds.length} card(s)`;
    this.advanceTurn();
    return {};
  }

  respond(playerId: string, accept: boolean, paymentCardIds?: string[]): { error?: string } {
    if (!this.pendingAction) return { error: 'No pending action' };
    if (!this.pendingAction.targetPlayerIds.includes(playerId)) return { error: 'Not your action to respond to' };
    if (this.pendingAction.respondedPlayerIds.includes(playerId)) return { error: 'Already responded' };

    // Just Say No
    if (!accept) {
      const hand = this.hands.get(playerId)!;
      const jsn = hand.findIndex(c => c.type === 'action' && c.actionType === 'just_say_no');
      if (jsn === -1) return { error: 'You need a Just Say No card to refuse' };
      hand.splice(jsn, 1);
      this.pendingAction.respondedPlayerIds.push(playerId);
      this.lastAction = `${this.getName(playerId)} said Just Say No!`;

      // Check if all targets responded
      if (this.allTargetsResponded()) {
        this.pendingAction = null;
      }
      return {};
    }

    // Accept the action
    const pa = this.pendingAction;
    switch (pa.type) {
      case 'rent':
      case 'debt_collector':
      case 'its_my_birthday': {
        if (!paymentCardIds || paymentCardIds.length === 0) {
          // Check if player has nothing to pay with
          const total = this.getPlayerTotalValue(playerId);
          if (total === 0) {
            this.pendingAction.respondedPlayerIds.push(playerId);
            this.lastAction = `${this.getName(playerId)} has nothing to pay`;
            break;
          }
          return { error: 'Must select cards to pay with' };
        }
        const result = this.processPayment(playerId, pa.sourcePlayerId, paymentCardIds, pa.amount!);
        if (result.error) return result;
        this.pendingAction.respondedPlayerIds.push(playerId);
        this.lastAction = `${this.getName(playerId)} paid $${result.paid}M`;
        break;
      }

      case 'deal_breaker': {
        // Transfer the complete set
        const targetSets = this.properties.get(playerId)!;
        const setIdx = targetSets.findIndex(s => s.color === pa.targetSetColor && s.isComplete);
        if (setIdx === -1) return { error: 'Set not found' };
        const [stolen] = targetSets.splice(setIdx, 1);
        this.properties.get(pa.sourcePlayerId)!.push(stolen);
        this.pendingAction.respondedPlayerIds.push(playerId);
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
        this.pendingAction.respondedPlayerIds.push(playerId);
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
        this.pendingAction.respondedPlayerIds.push(playerId);
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
          type: 'debt_collector',
          sourcePlayerId: playerId,
          targetPlayerIds: [opts.targetPlayerId],
          amount: 5,
          respondedPlayerIds: [],
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
          type: 'its_my_birthday',
          sourcePlayerId: playerId,
          targetPlayerIds: others,
          amount: 2,
          respondedPlayerIds: [],
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
          type: 'deal_breaker',
          sourcePlayerId: playerId,
          targetPlayerIds: [opts.targetPlayerId],
          targetSetColor: opts.targetSetColor,
          respondedPlayerIds: [],
        };
        this.lastAction = `${this.getName(playerId)} played Deal Breaker on ${this.getName(opts.targetPlayerId)}'s ${opts.targetSetColor} set!`;
        break;
      }

      case 'sly_deal': {
        if (!opts.targetPlayerId || !opts.targetCardId) return { error: 'Must select target player and card' };
        // Can't steal from complete sets
        const targetSets = this.properties.get(opts.targetPlayerId)!;
        const targetSet = targetSets.find(s => s.cards.some(c => c.id === opts.targetCardId));
        if (!targetSet) return { error: 'Card not found in target properties' };
        if (targetSet.isComplete) return { error: "Can't steal from a complete set" };
        hand.splice(cardIndex, 1);
        this.discardPile.push(card);
        this.actionsRemaining--;
        this.pendingAction = {
          type: 'sly_deal',
          sourcePlayerId: playerId,
          targetPlayerIds: [opts.targetPlayerId],
          targetCardId: opts.targetCardId,
          respondedPlayerIds: [],
        };
        this.lastAction = `${this.getName(playerId)} played Sly Deal on ${this.getName(opts.targetPlayerId)}`;
        break;
      }

      case 'forced_deal': {
        if (!opts.targetPlayerId || !opts.targetCardId || !opts.offeredCardId) {
          return { error: 'Must select target player, their card, and your offered card' };
        }
        // Can't swap from complete sets
        const tSets = this.properties.get(opts.targetPlayerId)!;
        const tSet = tSets.find(s => s.cards.some(c => c.id === opts.targetCardId));
        if (!tSet) return { error: 'Card not found in target properties' };
        if (tSet.isComplete) return { error: "Can't swap from a complete set" };
        hand.splice(cardIndex, 1);
        this.discardPile.push(card);
        this.actionsRemaining--;
        this.pendingAction = {
          type: 'forced_deal',
          sourcePlayerId: playerId,
          targetPlayerIds: [opts.targetPlayerId],
          offeredCardId: opts.offeredCardId,
          requestedCardId: opts.targetCardId,
          respondedPlayerIds: [],
        };
        this.lastAction = `${this.getName(playerId)} played Forced Deal on ${this.getName(opts.targetPlayerId)}`;
        break;
      }

      case 'house': {
        if (!opts.color) return { error: 'Must select which set to add house to' };
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
        return { error: 'Double The Rent must be played with a Rent card (play rent first, it auto-doubles)' };

      case 'just_say_no':
        // Can be banked as money, but not played as action on its own
        return { error: 'Just Say No can only be used in response to actions against you (or bank it as money)' };
    }

    this.checkEndTurn(playerId);
    return {};
  }

  private playRent(playerId: string, cardIndex: number, card: AnyCard & { colors: [PropertyColor, PropertyColor] | 'all' }, opts: PlayCardOpts): { error?: string } {
    const hand = this.hands.get(playerId)!;
    const color = opts.color;
    if (!color) return { error: 'Must select a color for rent' };

    if (card.colors !== 'all' && !card.colors.includes(color)) {
      return { error: `This rent card can't be used for ${color}` };
    }

    // Calculate rent
    const sets = this.properties.get(playerId)!;
    const set = sets.find(s => s.color === color);
    if (!set || set.cards.length === 0) return { error: `You have no ${color} properties` };

    const propertyCount = set.cards.filter(c =>
      c.type === 'property' || c.type === 'property_wildcard'
    ).length;
    const rentIndex = Math.min(propertyCount, RENT_VALUES[color].length) - 1;
    let rentAmount = RENT_VALUES[color][rentIndex] || 0;

    // House adds 3M, Hotel adds 4M
    if (set.hasHouse) rentAmount += 3;
    if (set.hasHotel) rentAmount += 4;

    // Check for Double The Rent in hand
    const doubleIdx = hand.findIndex(c =>
      c.id !== card.id && c.type === 'action' && c.actionType === 'double_the_rent'
    );
    if (doubleIdx !== -1 && this.actionsRemaining >= 2) {
      // Auto-use double the rent
      const [doubleCard] = hand.splice(doubleIdx > cardIndex ? doubleIdx : doubleIdx, 1);
      this.discardPile.push(doubleCard);
      rentAmount *= 2;
      // Adjust cardIndex if needed
      const newCardIndex = hand.findIndex(c => c.id === card.id);
      hand.splice(newCardIndex, 1);
      this.discardPile.push(card);
      this.actionsRemaining -= 2;
      this.lastAction = `${this.getName(playerId)} charged DOUBLE rent: $${rentAmount}M for ${color}!`;
    } else {
      hand.splice(cardIndex, 1);
      this.discardPile.push(card);
      this.actionsRemaining--;
      this.lastAction = `${this.getName(playerId)} charged $${rentAmount}M rent for ${color}`;
    }

    // Wild rent targets one player, normal rent targets all
    const targetIds = card.colors === 'all' && opts.targetPlayerId
      ? [opts.targetPlayerId]
      : this.playerOrder.filter(id => id !== playerId);

    if (card.colors === 'all' && !opts.targetPlayerId) {
      return { error: 'Wild rent requires selecting a target player' };
    }

    this.pendingAction = {
      type: 'rent',
      sourcePlayerId: playerId,
      targetPlayerIds: targetIds,
      amount: rentAmount,
      respondedPlayerIds: [],
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
    // Find an incomplete set of this color
    let set = sets.find(s => s.color === color && !s.isComplete);
    if (!set) {
      set = { color, cards: [], hasHouse: false, hasHotel: false, isComplete: false };
      sets.push(set);
    }
    set.cards.push(card);
    // Check if set is complete
    const propCount = set.cards.filter(c =>
      c.type === 'property' || c.type === 'property_wildcard'
    ).length;
    set.isComplete = propCount >= SET_SIZE[color];
  }

  private removePropertyCard(playerId: string, cardId: string): AnyCard | null {
    const sets = this.properties.get(playerId)!;
    for (let i = 0; i < sets.length; i++) {
      const cardIdx = sets[i].cards.findIndex(c => c.id === cardId);
      if (cardIdx !== -1) {
        const [card] = sets[i].cards.splice(cardIdx, 1);
        // Recalculate completeness
        const propCount = sets[i].cards.filter(c =>
          c.type === 'property' || c.type === 'property_wildcard'
        ).length;
        sets[i].isComplete = propCount >= SET_SIZE[sets[i].color];
        // Remove house/hotel if no longer complete
        if (!sets[i].isComplete) {
          if (sets[i].hasHotel) {
            sets[i].hasHotel = false;
            const hotelIdx = sets[i].cards.findIndex(c => c.type === 'action' && (c as any).actionType === 'hotel');
            if (hotelIdx !== -1) {
              const [hotel] = sets[i].cards.splice(hotelIdx, 1);
              this.hands.get(playerId)!.push(hotel);
            }
          }
          if (sets[i].hasHouse) {
            sets[i].hasHouse = false;
            const houseIdx = sets[i].cards.findIndex(c => c.type === 'action' && (c as any).actionType === 'house');
            if (houseIdx !== -1) {
              const [house] = sets[i].cards.splice(houseIdx, 1);
              this.hands.get(playerId)!.push(house);
            }
          }
        }
        // Remove empty sets
        if (sets[i].cards.length === 0) {
          sets.splice(i, 1);
        }
        return card;
      }
    }
    return null;
  }

  private processPayment(fromId: string, toId: string, cardIds: string[], amount: number): { error?: string; paid?: number } {
    let paid = 0;
    const fromBank = this.banks.get(fromId)!;
    const fromSets = this.properties.get(fromId)!;
    const toBank = this.banks.get(toId)!;

    for (const id of cardIds) {
      // Try bank first
      let idx = fromBank.findIndex(c => c.id === id);
      if (idx !== -1) {
        const [card] = fromBank.splice(idx, 1);
        toBank.push(card);
        paid += card.value;
        continue;
      }
      // Try properties
      const card = this.removePropertyCard(fromId, id);
      if (card) {
        toBank.push(card);
        paid += card.value;
        continue;
      }
      return { error: `Card ${id} not found in your bank or properties` };
    }

    // No change given in Monopoly Deal — overpayment is the payer's loss
    return { paid };
  }

  private getPlayerTotalValue(playerId: string): number {
    let total = 0;
    for (const card of this.banks.get(playerId)!) {
      total += card.value;
    }
    for (const set of this.properties.get(playerId)!) {
      for (const card of set.cards) {
        total += card.value;
      }
    }
    return total;
  }

  private getName(playerId: string): string {
    return this.playerNames.get(playerId) || playerId.slice(0, 6);
  }

  private checkWin(playerId: string) {
    const sets = this.properties.get(playerId)!;
    const completeSets = sets.filter(s => s.isComplete);
    // Need 3 complete sets of DIFFERENT colors to win
    const uniqueColors = new Set(completeSets.map(s => s.color));
    if (uniqueColors.size >= 3) {
      this.winnerId = playerId;
      this.lastAction = `${this.getName(playerId)} WINS with 3 complete sets!`;
    }
  }

  private checkEndTurn(playerId: string) {
    if (this.actionsRemaining <= 0 && !this.pendingAction) {
      const hand = this.hands.get(playerId)!;
      if (hand.length > 7) {
        this.turnPhase = 'discard';
      }
      // Don't auto-advance — player must explicitly end turn
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
    // Skip disconnected players
    let attempts = 0;
    while (!this.playerConnected.get(this.playerOrder[this.currentPlayerIndex]) && attempts < this.playerOrder.length) {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerOrder.length;
      attempts++;
    }
    this.turnPhase = 'draw';
    this.actionsRemaining = 0;
    this.turnNumber++;
    this.lastAction = `It's ${this.getName(this.playerOrder[this.currentPlayerIndex])}'s turn`;
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
      discardPile: this.discardPile.slice(-3), // only show top 3
      phase: this.winnerId ? 'finished' : 'playing',
      winnerId: this.winnerId,
      turnNumber: this.turnNumber,
      pendingAction: this.pendingAction,
      lastAction: this.lastAction,
    };
  }

  setDisconnected(playerId: string) {
    this.playerConnected.set(playerId, false);
  }

  setConnected(playerId: string) {
    this.playerConnected.set(playerId, true);
  }
}

// Re-export shuffleDeck for deck building
export { shuffleDeck } from './deck.js';
