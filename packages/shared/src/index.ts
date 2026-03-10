// ─── Property Colors ──────────────────────────────────────────────────────────

export type PropertyColor =
  | 'brown' | 'blue' | 'green' | 'light_blue'
  | 'orange' | 'pink' | 'railroad' | 'red'
  | 'yellow' | 'utility';

export const PROPERTY_COLORS: PropertyColor[] = [
  'brown', 'blue', 'green', 'light_blue',
  'orange', 'pink', 'railroad', 'red',
  'yellow', 'utility',
];

// How many properties needed to complete a set
export const SET_SIZE: Record<PropertyColor, number> = {
  brown: 2, blue: 2, green: 3, light_blue: 3,
  orange: 3, pink: 3, railroad: 4, red: 3,
  yellow: 3, utility: 2,
};

// Rent values indexed by number of properties in the set (1-indexed)
export const RENT_VALUES: Record<PropertyColor, number[]> = {
  brown:      [1, 2],
  blue:       [3, 8],
  green:      [2, 4, 7],
  light_blue: [1, 2, 3],
  orange:     [1, 3, 5],
  pink:       [1, 2, 4],
  railroad:   [1, 2, 3, 4],
  red:        [2, 3, 6],
  yellow:     [2, 4, 6],
  utility:    [1, 2],
};

// Display colors for UI
export const COLOR_HEX: Record<PropertyColor, string> = {
  brown:      '#8B4513',
  blue:       '#0000CD',
  green:      '#228B22',
  light_blue: '#87CEEB',
  orange:     '#FF8C00',
  pink:       '#FF69B4',
  railroad:   '#333333',
  red:        '#DC143C',
  yellow:     '#FFD700',
  utility:    '#90EE90',
};

// French color names (for UI display)
export const COLOR_NAMES: Record<PropertyColor, string> = {
  brown:      'Marron',
  blue:       'Bleu fonce',
  green:      'Vert',
  light_blue: 'Bleu clair',
  orange:     'Orange',
  pink:       'Rose',
  railroad:   'Gare',
  red:        'Rouge',
  yellow:     'Jaune',
  utility:    'Service public',
};

// ─── Card Types ───────────────────────────────────────────────────────────────

export type CardType = 'money' | 'property' | 'action' | 'rent' | 'property_wildcard';

export type ActionType =
  | 'pass_go' | 'deal_breaker' | 'just_say_no'
  | 'sly_deal' | 'forced_deal' | 'debt_collector'
  | 'its_my_birthday' | 'house' | 'hotel'
  | 'double_the_rent';

// English canonical names (internal) -> French display names (UI)
export const DISPLAY_NAMES: Record<string, string> = {
  'Pass Go':           'Passez par la case Depart',
  'Deal Breaker':      'Rupture de transaction',
  'Just Say No':       'Non !',
  'Sly Deal':          'Vol de propriété',
  'Forced Deal':       'Marché forcé',
  'Debt Collector':    'Collecteur de dette',
  "It's My Birthday":  "C'est votre anniversaire !",
  'House':             'Maison',
  'Hotel':             'Hôtel',
  'Double the Rent':   'Loyer Double',
  'Wild Rent':         'Loyer Ciblé',
  'Property Wildcard': 'Joker Propriété',
};

export function displayName(card: AnyCard): string {
  if (card.type === 'money') return `${card.value}M`;
  return DISPLAY_NAMES[card.name] || card.name;
}

export interface CardBase {
  id: string;
  type: CardType;
  name: string;
  description: string;
  value: number; // bank value in M
}

export interface MoneyCard extends CardBase {
  type: 'money';
}

export interface PropertyCard extends CardBase {
  type: 'property';
  color: PropertyColor;
}

export interface WildcardCard extends CardBase {
  type: 'property_wildcard';
  colors: [PropertyColor, PropertyColor] | 'all';
  currentColor: PropertyColor;
}

export interface ActionCard extends CardBase {
  type: 'action';
  actionType: ActionType;
}

export interface RentCard extends CardBase {
  type: 'rent';
  colors: [PropertyColor, PropertyColor] | 'all';
}

export type AnyCard = MoneyCard | PropertyCard | WildcardCard | ActionCard | RentCard;

// ─── Player ───────────────────────────────────────────────────────────────────

export interface PropertySet {
  color: PropertyColor;
  cards: AnyCard[]; // property + wildcards + orphaned house/hotel
  hasHouse: boolean;
  hasHotel: boolean;
  isComplete: boolean;
}

export interface Player {
  id: string;
  name: string;
  handCount: number;
  bank: AnyCard[];
  propertySets: PropertySet[];
  connected: boolean;
}

// ─── Game State ───────────────────────────────────────────────────────────────

export type GamePhase = 'waiting' | 'playing' | 'finished';
export type TurnPhase = 'draw' | 'action' | 'discard' | 'waiting';

export interface JsnChain {
  lastPlayedBy: string;
  awaitingCounterFrom: string;
  actionCancelled: boolean;
}

export interface PendingAction {
  type: 'rent' | 'debt_collector' | 'its_my_birthday' | 'deal_breaker' | 'sly_deal' | 'forced_deal';
  sourcePlayerId: string;
  targetPlayerIds: string[];
  amount?: number;
  baseAmount?: number;
  respondedPlayerIds: string[];
  targetSetColor?: PropertyColor;
  targetCardId?: string;
  offeredCardId?: string;
  requestedCardId?: string;
  jsnChain?: JsnChain;
}

export interface GameState {
  players: Player[];
  currentPlayerIndex: number;
  actionsRemaining: number;
  turnPhase: TurnPhase;
  drawPileCount: number;
  discardPile: AnyCard[];
  phase: GamePhase;
  winnerId?: string;
  turnNumber: number;
  pendingAction: PendingAction | null;
  lastAction?: string;
}

// ─── Room ─────────────────────────────────────────────────────────────────────

export interface RoomInfo {
  id: string;
  name: string;
  hostId: string;
  players: { id: string; name: string; connected: boolean }[];
  maxPlayers: number;
  phase: GamePhase;
}

// ─── Socket Events ────────────────────────────────────────────────────────────

export interface ClientEvents {
  'room:create': (data: { playerName: string; roomName: string }) => void;
  'room:join': (data: { playerName: string; roomId: string }) => void;
  'room:leave': () => void;
  'game:start': () => void;
  'game:draw': () => void;
  'game:play-card': (data: {
    cardId: string;
    asMoney?: boolean;
    color?: PropertyColor;
    targetPlayerId?: string;
    targetCardId?: string;
    offeredCardId?: string;
    targetSetColor?: PropertyColor;
    doubleTheRentCardIds?: string[];
  }) => void;
  'game:end-turn': () => void;
  'game:discard': (data: { cardIds: string[] }) => void;
  'game:respond': (data: { accept: boolean; paymentCardIds?: string[] }) => void;
  'game:rearrange': (data: { cardId: string; toColor: PropertyColor }) => void;
  'rooms:list': () => void;
}

export interface ServerEvents {
  'room:created': (room: RoomInfo) => void;
  'room:joined': (room: RoomInfo) => void;
  'room:updated': (room: RoomInfo) => void;
  'room:left': () => void;
  'rooms:list': (rooms: RoomInfo[]) => void;
  'game:state': (state: GameState) => void;
  'game:hand': (hand: AnyCard[]) => void;
  'game:notification': (msg: string) => void;
  'error': (message: string) => void;
}
