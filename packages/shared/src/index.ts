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

// ─── Card Types ───────────────────────────────────────────────────────────────

export type CardType = 'money' | 'property' | 'action' | 'rent' | 'property_wildcard';

export type ActionType =
  | 'pass_go' | 'deal_breaker' | 'just_say_no'
  | 'sly_deal' | 'forced_deal' | 'debt_collector'
  | 'its_my_birthday' | 'house' | 'hotel'
  | 'double_the_rent';

export interface CardBase {
  id: string;
  type: CardType;
  name: string;
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
  cards: AnyCard[]; // property + wildcards
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

export interface PendingAction {
  type: 'rent' | 'debt_collector' | 'its_my_birthday' | 'deal_breaker' | 'sly_deal' | 'forced_deal';
  sourcePlayerId: string;
  targetPlayerIds: string[];
  amount?: number;
  respondedPlayerIds: string[];
  // For deal_breaker
  targetSetColor?: PropertyColor;
  // For sly_deal
  targetCardId?: string;
  // For forced_deal
  offeredCardId?: string;
  requestedCardId?: string;
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
  }) => void;
  'game:end-turn': () => void;
  'game:discard': (data: { cardIds: string[] }) => void;
  'game:respond': (data: { accept: boolean; paymentCardIds?: string[] }) => void;
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
