import { useState } from 'react';
import { socket } from '../socket/index.ts';
import { useStore } from '../store/useStore.ts';

export function Lobby() {
  const { playerName, rooms, connected } = useStore();
  const [roomName, setRoomName] = useState('');
  const [joinId, setJoinId] = useState('');

  return (
    <div className="center-screen">
      <div className="logo">MONOPOLY DEAL</div>
      <p className="subtitle">
        {playerName} {connected ? '- Connected' : '- Disconnected'}
      </p>

      <div className="panel">
        <h2>Create a Room</h2>
        <div className="row">
          <input
            placeholder="Room name"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && roomName.trim()) {
                socket.emit('room:create', { playerName, roomName: roomName.trim() });
              }
            }}
          />
          <button onClick={() => {
            if (roomName.trim()) socket.emit('room:create', { playerName, roomName: roomName.trim() });
          }}>Create</button>
        </div>
      </div>

      <div className="panel">
        <h2>Join by Code</h2>
        <div className="row">
          <input
            placeholder="Room code"
            value={joinId}
            onChange={(e) => setJoinId(e.target.value.toUpperCase())}
            maxLength={6}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && joinId) socket.emit('room:join', { playerName, roomId: joinId });
            }}
          />
          <button onClick={() => {
            if (joinId) socket.emit('room:join', { playerName, roomId: joinId });
          }}>Join</button>
        </div>
      </div>

      {rooms.filter(r => r.phase === 'waiting').length > 0 && (
        <div className="panel">
          <h2>Open Rooms</h2>
          <ul className="room-list">
            {rooms.filter(r => r.phase === 'waiting').map(r => (
              <li key={r.id}>
                <span><strong>{r.name}</strong> - {r.players.length}/{r.maxPlayers}</span>
                <button className="small" onClick={() => socket.emit('room:join', { playerName, roomId: r.id })}>
                  Join
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
