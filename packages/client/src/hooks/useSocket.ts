import { useEffect } from 'react';
import { socket } from '../socket/index.ts';
import { useStore } from '../store/useStore.ts';

export function useSocket() {
  const {
    setConnected, setRooms, setCurrentRoom,
    setGameState, setHand, addNotification, setError,
    addChatMessage, addFloatingReaction, removeFloatingReaction,
  } = useStore();

  useEffect(() => {
    socket.connect();

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('rooms:list');

      // Attempt to rejoin a room after reload
      const savedRoom = localStorage.getItem('monopoly-room');
      const playerName = localStorage.getItem('monopoly-name');
      if (savedRoom && playerName) {
        socket.emit('room:rejoin', { playerName, roomId: savedRoom });
      }
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on('rooms:list', (rooms) => setRooms(rooms));
    socket.on('room:created', (room) => setCurrentRoom(room));
    socket.on('room:joined', (room) => setCurrentRoom(room));
    socket.on('room:rejoined', (room) => setCurrentRoom(room));
    socket.on('room:updated', (room) => setCurrentRoom(room));
    socket.on('room:left', () => {
      setCurrentRoom(null);
      setGameState(null);
      setHand([]);
    });

    socket.on('game:state', (state) => setGameState(state));
    socket.on('game:hand', (hand) => setHand(hand));
    socket.on('game:notification', (msg) => addNotification(msg));
    socket.on('error', (msg) => setError(msg));

    socket.on('chat:message', (msg) => addChatMessage(msg));
    socket.on('chat:reaction', (reaction) => {
      addFloatingReaction(reaction);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);
}
