import { create } from 'zustand';
import type { RoomInfo, GameState, AnyCard } from '@monopoly-deal/shared';

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

  notifications: string[];
  addNotification: (msg: string) => void;

  errorMsg: string | null;
  setError: (msg: string | null) => void;
}

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
  setCurrentRoom: (room) => set({ currentRoom: room }),

  gameState: null,
  setGameState: (state) => set({ gameState: state }),
  hand: [],
  setHand: (hand) => set({ hand }),

  notifications: [],
  addNotification: (msg) => set((s) => ({
    notifications: [...s.notifications.slice(-29), msg],
  })),

  errorMsg: null,
  setError: (msg) => {
    set({ errorMsg: msg });
    if (msg) setTimeout(() => set({ errorMsg: null }), 3000);
  },
}));
