import type { Server, Socket } from 'socket.io';
import type { ClientEvents, ServerEvents } from '@monopoly-deal/shared';
import { roomManager } from '../rooms/RoomManager.js';

type IO = Server<ClientEvents, ServerEvents>;
type TypedSocket = Socket<ClientEvents, ServerEvents>;

export function registerHandlers(io: IO, socket: TypedSocket) {
  // ─── Room Events ────────────────────────────────────────────────────

  socket.on('rooms:list', () => {
    socket.emit('rooms:list', roomManager.listRooms());
  });

  socket.on('room:create', ({ playerName, roomName }) => {
    const room = roomManager.createRoom(socket.id, playerName, roomName);
    socket.join(room.id);
    socket.emit('room:created', room);
    io.emit('rooms:list', roomManager.listRooms());
  });

  socket.on('room:join', ({ playerName, roomId }) => {
    const room = roomManager.joinRoom(socket.id, playerName, roomId);
    if (!room) {
      socket.emit('error', 'Cannot join room');
      return;
    }
    socket.join(room.id);
    socket.emit('room:joined', room);
    io.to(room.id).emit('room:updated', room);
    io.emit('rooms:list', roomManager.listRooms());
  });

  socket.on('room:rejoin', ({ playerName, roomId }) => {
    const room = roomManager.rejoinRoom(socket.id, playerName, roomId);
    if (!room) {
      socket.emit('error', 'Cannot rejoin room');
      return;
    }
    socket.join(room.id);
    socket.emit('room:rejoined', room);
    io.to(room.id).emit('room:updated', room);
    io.emit('rooms:list', roomManager.listRooms());

    // If game is in progress, send them the current state
    const game = roomManager.getGame(roomId);
    if (game) {
      broadcastState(io, roomId);
    }
  });

  socket.on('room:leave', () => handleLeave(io, socket));

  // ─── Game Events ────────────────────────────────────────────────────

  socket.on('game:start', () => {
    const roomId = roomManager.getRoomIdForSocket(socket.id);
    if (!roomId) return;
    const roomData = roomManager.getRoom(roomId);
    if (!roomData || roomData.hostId !== socket.id) {
      socket.emit('error', 'Only the host can start the game');
      return;
    }

    const game = roomManager.startGame(roomId);
    if (!game) {
      socket.emit('error', 'Need at least 2 players to start');
      return;
    }

    broadcastState(io, roomId);
    io.to(roomId).emit('room:updated', roomManager.getRoomInfo(roomId)!);
    io.emit('rooms:list', roomManager.listRooms());
  });

  socket.on('game:draw', () => {
    const roomId = roomManager.getRoomIdForSocket(socket.id);
    if (!roomId) return;
    const game = roomManager.getGame(roomId);
    if (!game) return;

    const result = game.draw(socket.id);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }
    broadcastState(io, roomId);
  });

  socket.on('game:play-card', (data) => {
    const roomId = roomManager.getRoomIdForSocket(socket.id);
    if (!roomId) return;
    const game = roomManager.getGame(roomId);
    if (!game) return;

    const result = game.playCard(socket.id, data.cardId, {
      asMoney: data.asMoney,
      color: data.color,
      targetPlayerId: data.targetPlayerId,
      targetCardId: data.targetCardId,
      offeredCardId: data.offeredCardId,
      targetSetColor: data.targetSetColor,
      doubleTheRentCardIds: data.doubleTheRentCardIds,
    });
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }
    broadcastState(io, roomId);
  });

  socket.on('game:rearrange', ({ cardId, toColor }) => {
    const roomId = roomManager.getRoomIdForSocket(socket.id);
    if (!roomId) return;
    const game = roomManager.getGame(roomId);
    if (!game) return;

    const result = game.rearrange(socket.id, cardId, toColor);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }
    broadcastState(io, roomId);
  });

  socket.on('game:end-turn', () => {
    const roomId = roomManager.getRoomIdForSocket(socket.id);
    if (!roomId) return;
    const game = roomManager.getGame(roomId);
    if (!game) return;

    const result = game.endTurn(socket.id);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }
    broadcastState(io, roomId);
  });

  socket.on('game:discard', ({ cardIds }) => {
    const roomId = roomManager.getRoomIdForSocket(socket.id);
    if (!roomId) return;
    const game = roomManager.getGame(roomId);
    if (!game) return;

    const result = game.discard(socket.id, cardIds);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }
    broadcastState(io, roomId);
  });

  socket.on('game:respond', ({ accept, paymentCardIds }) => {
    const roomId = roomManager.getRoomIdForSocket(socket.id);
    if (!roomId) return;
    const game = roomManager.getGame(roomId);
    if (!game) return;

    const result = game.respond(socket.id, accept, paymentCardIds);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }
    broadcastState(io, roomId);
  });

  // ─── Chat Events ───────────────────────────────────────────────────

  socket.on('chat:message', ({ text }) => {
    const roomId = roomManager.getRoomIdForSocket(socket.id);
    if (!roomId) return;
    const roomInfo = roomManager.getRoomInfo(roomId);
    if (!roomInfo) return;
    const player = roomInfo.players.find(p => p.id === socket.id);
    if (!player) return;

    const trimmed = text.trim().slice(0, 200);
    if (!trimmed) return;

    io.to(roomId).emit('chat:message', {
      id: `${Date.now()}-${socket.id}`,
      playerName: player.name,
      playerId: socket.id,
      text: trimmed,
      timestamp: Date.now(),
    });
  });

  socket.on('chat:reaction', ({ emoji }) => {
    const roomId = roomManager.getRoomIdForSocket(socket.id);
    if (!roomId) return;
    const roomInfo = roomManager.getRoomInfo(roomId);
    if (!roomInfo) return;
    const player = roomInfo.players.find(p => p.id === socket.id);
    if (!player) return;

    io.to(roomId).emit('chat:reaction', {
      playerName: player.name,
      playerId: socket.id,
      emoji,
    });
  });

  // ─── Disconnect ─────────────────────────────────────────────────────

  socket.on('disconnect', () => handleLeave(io, socket));
}

function handleLeave(io: IO, socket: TypedSocket) {
  const result = roomManager.leaveRoom(socket.id);
  if (!result) return;

  socket.leave(result.roomId);
  socket.emit('room:left');

  if (result.room) {
    io.to(result.roomId).emit('room:updated', result.room);
    const game = roomManager.getGame(result.roomId);
    if (game) broadcastState(io, result.roomId);
  }
  io.emit('rooms:list', roomManager.listRooms());
}

function broadcastState(io: IO, roomId: string) {
  const game = roomManager.getGame(roomId);
  if (!game) return;

  const state = game.getState();
  io.to(roomId).emit('game:state', state);

  for (const player of state.players) {
    const hand = game.getHand(player.id);
    const playerSocket = io.sockets.sockets.get(player.id);
    playerSocket?.emit('game:hand', hand);
  }

  if (state.lastAction) {
    io.to(roomId).emit('game:notification', state.lastAction);
  }
}
