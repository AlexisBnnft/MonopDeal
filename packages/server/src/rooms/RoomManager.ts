import { v4 as uuid } from 'uuid';
import type { RoomInfo, GameState, AnyCard, PropertyColor } from '@monopoly-deal/shared';
import { GameEngine } from '../game/GameEngine.js';

interface Room {
  id: string;
  name: string;
  hostId: string;
  players: Map<string, { socketId: string; name: string; connected: boolean }>;
  maxPlayers: number;
  game: GameEngine | null;
}

class RoomManager {
  private rooms = new Map<string, Room>();
  private socketToRoom = new Map<string, string>();

  createRoom(socketId: string, playerName: string, roomName: string): RoomInfo {
    const roomId = uuid().slice(0, 6).toUpperCase();

    const room: Room = {
      id: roomId,
      name: roomName,
      hostId: socketId,
      players: new Map([[socketId, { socketId, name: playerName, connected: true }]]),
      maxPlayers: 5,
      game: null,
    };

    this.rooms.set(roomId, room);
    this.socketToRoom.set(socketId, roomId);
    return this.getRoomInfo(roomId)!;
  }

  joinRoom(socketId: string, playerName: string, roomId: string): RoomInfo | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.players.size >= room.maxPlayers) return null;
    if (room.game) return null; // Can't join mid-game

    room.players.set(socketId, { socketId, name: playerName, connected: true });
    this.socketToRoom.set(socketId, roomId);
    return this.getRoomInfo(roomId)!;
  }

  leaveRoom(socketId: string): { roomId: string; room: RoomInfo | null } | null {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    if (!room) return null;

    this.socketToRoom.delete(socketId);

    if (room.game) {
      const player = room.players.get(socketId);
      if (player) {
        player.connected = false;
        room.game.setDisconnected(socketId);
      }
    } else {
      room.players.delete(socketId);
    }

    if (room.players.size === 0 || [...room.players.values()].every(p => !p.connected)) {
      this.rooms.delete(roomId);
      return { roomId, room: null };
    }

    if (room.hostId === socketId) {
      const nextHost = [...room.players.entries()].find(([, p]) => p.connected);
      if (nextHost) room.hostId = nextHost[0];
    }

    return { roomId, room: this.getRoomInfo(roomId) };
  }

  getRoomIdForSocket(socketId: string): string | undefined {
    return this.socketToRoom.get(socketId);
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getRoomInfo(roomId: string): RoomInfo | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    return {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      players: [...room.players.entries()].map(([id, p]) => ({
        id,
        name: p.name,
        connected: p.connected,
      })),
      maxPlayers: room.maxPlayers,
      phase: room.game
        ? (room.game.getState().phase)
        : 'waiting',
    };
  }

  listRooms(): RoomInfo[] {
    return [...this.rooms.values()].map(r => this.getRoomInfo(r.id)!);
  }

  // ─── Game ───────────────────────────────────────────────────────────

  startGame(roomId: string): GameEngine | null {
    const room = this.rooms.get(roomId);
    if (!room || room.players.size < 2) return null;

    const players = [...room.players.entries()].map(([id, p]) => ({ id, name: p.name }));
    room.game = new GameEngine(players);
    return room.game;
  }

  getGame(roomId: string): GameEngine | null {
    return this.rooms.get(roomId)?.game ?? null;
  }
}

export const roomManager = new RoomManager();
