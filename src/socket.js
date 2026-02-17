import { io } from 'socket.io-client';

const URL =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.PROD ? '' : 'http://localhost:3001');

const socket = io(URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
});

export default socket;
