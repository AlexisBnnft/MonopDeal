import { useEffect } from 'react';
import { socket } from '../socket/index.ts';
import { useStore } from '../store/useStore.ts';

export function useSocket() {
  const {
    setConnected, setRooms, setCurrentRoom,
    setGameState, setHand, addNotification, setError,
  } = useStore();

  useEffect(() => {
    socket.connect();

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('rooms:list');
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on('rooms:list', (rooms) => setRooms(rooms));
    socket.on('room:created', (room) => setCurrentRoom(room));
    socket.on('room:joined', (room) => setCurrentRoom(room));
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

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);
}
