import { create } from 'zustand';
import type { RoomInfo, GameState, AnyCard, ChatMessage, ReactionEvent } from '@monopoly-deal/shared';

interface FloatingReaction extends ReactionEvent {
  id: string;
  x: number; // random horizontal position (%)
}

interface Store {
  playerName: string;
  setPlayerName: (name: string) => void;
  connected: boolean;
  setConnected: (v: boolean) => void;

  rooms: RoomInfo[];
  setRooms: (rooms: RoomInfo[]) => void;
  currentRoom: RoomInfo | null;
  setCurrentRoom: (room: RoomInfo | null) => void;

  gameState: GameState | null;
  setGameState: (state: GameState | null) => void;
  hand: AnyCard[];
  setHand: (hand: AnyCard[]) => void;
  reorderHand: (fromIndex: number, toIndex: number) => void;
  sortHand: (by: 'type' | 'color' | 'value') => void;

  notifications: string[];
  addNotification: (msg: string) => void;

  chatMessages: ChatMessage[];
  addChatMessage: (msg: ChatMessage) => void;
  floatingReactions: FloatingReaction[];
  addFloatingReaction: (reaction: ReactionEvent) => void;
  removeFloatingReaction: (id: string) => void;

  errorMsg: string | null;
  setError: (msg: string | null) => void;
}

const CARD_TYPE_ORDER: Record<string, number> = {
  property: 0, property_wildcard: 1, action: 2, rent: 3, money: 4,
};

export const useStore = create<Store>((set) => ({
  playerName: localStorage.getItem('monopoly-name') || '',
  setPlayerName: (name) => {
    localStorage.setItem('monopoly-name', name);
    set({ playerName: name });
  },
  connected: false,
  setConnected: (v) => set({ connected: v }),

  rooms: [],
  setRooms: (rooms) => set({ rooms }),
  currentRoom: null,
  setCurrentRoom: (room) => {
    if (room) {
      localStorage.setItem('monopoly-room', room.id);
    } else {
      localStorage.removeItem('monopoly-room');
    }
    set({ currentRoom: room, chatMessages: [] });
  },

  gameState: null,
  setGameState: (state) => set({ gameState: state }),
  hand: [],
  setHand: (hand) => set({ hand }),
  reorderHand: (fromIndex, toIndex) => set((s) => {
    const newHand = [...s.hand];
    const [card] = newHand.splice(fromIndex, 1);
    newHand.splice(toIndex, 0, card);
    return { hand: newHand };
  }),
  sortHand: (by) => set((s) => {
    const sorted = [...s.hand].sort((a, b) => {
      if (by === 'type') return (CARD_TYPE_ORDER[a.type] ?? 9) - (CARD_TYPE_ORDER[b.type] ?? 9);
      if (by === 'value') return b.value - a.value;
      // by color: group properties by color
      const colorA = a.type === 'property' ? a.color : a.type === 'property_wildcard' ? (a.colors === 'all' ? 'zzz' : a.colors[0]) : 'zzz';
      const colorB = b.type === 'property' ? b.color : b.type === 'property_wildcard' ? (b.colors === 'all' ? 'zzz' : b.colors[0]) : 'zzz';
      if (colorA !== colorB) return colorA.localeCompare(colorB);
      return (CARD_TYPE_ORDER[a.type] ?? 9) - (CARD_TYPE_ORDER[b.type] ?? 9);
    });
    return { hand: sorted };
  }),

  notifications: [],
  addNotification: (msg) => set((s) => ({
    notifications: [...s.notifications.slice(-29), msg],
  })),

  chatMessages: [],
  addChatMessage: (msg) => set((s) => ({
    chatMessages: [...s.chatMessages.slice(-49), msg],
  })),
  floatingReactions: [],
  addFloatingReaction: (reaction) => set((s) => ({
    floatingReactions: [...s.floatingReactions.slice(-9), {
      ...reaction,
      id: `${Date.now()}-${Math.random()}`,
      x: 15 + Math.random() * 70,
    }],
  })),
  removeFloatingReaction: (id) => set((s) => ({
    floatingReactions: s.floatingReactions.filter(r => r.id !== id),
  })),

  errorMsg: null,
  setError: (msg) => {
    set({ errorMsg: msg });
    if (msg) setTimeout(() => set({ errorMsg: null }), 3000);
  },
}));
