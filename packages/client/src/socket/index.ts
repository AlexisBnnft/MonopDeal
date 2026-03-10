import { io, Socket } from 'socket.io-client';
import type { ClientEvents, ServerEvents } from '@monopoly-deal/shared';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;

export const socket: Socket<ServerEvents, ClientEvents> = io(SERVER_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
});
