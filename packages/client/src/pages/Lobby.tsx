import { useState } from 'react';
import { socket } from '../socket/index.ts';
import { useStore } from '../store/useStore.ts';
import type { AIDifficulty } from '@monopoly-deal/shared';

const DIFFICULTIES: { value: AIDifficulty; label: string }[] = [
  { value: 'easy', label: 'Facile' },
  { value: 'medium', label: 'Normal' },
  { value: 'hard', label: 'Difficile' },
];

export function Lobby() {
  const { playerName, rooms, connected } = useStore();
  const [roomName, setRoomName] = useState('');
  const [joinId, setJoinId] = useState('');
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>('medium');
  const [aiBotCount, setAiBotCount] = useState(3);

  const launchAI = () => {
    socket.emit('room:create-ai', {
      playerName,
      roomName: `${playerName} vs IA`,
      botCount: aiBotCount,
      difficulty: aiDifficulty,
    });
  };

  return (
    <div className="center-screen">
      <div className="logo">MONOPOLY DEAL</div>
      <p className="subtitle">
        {playerName} {connected ? '— Connecte' : '— Deconnecte'}
      </p>

      <div className="panel">
        <h2>Jouer contre l'IA</h2>
        <div className="ai-options">
          <div className="ai-row">
            <span className="ai-label">Difficulte</span>
            <div className="btn-group">
              {DIFFICULTIES.map(d => (
                <button
                  key={d.value}
                  className={`small ${aiDifficulty === d.value ? 'btn-active' : 'btn-secondary'}`}
                  onClick={() => setAiDifficulty(d.value)}
                >{d.label}</button>
              ))}
            </div>
          </div>
          <div className="ai-row">
            <span className="ai-label">Adversaires</span>
            <div className="btn-group">
              {[1, 2, 3].map(n => (
                <button
                  key={n}
                  className={`small ${aiBotCount === n ? 'btn-active' : 'btn-secondary'}`}
                  onClick={() => setAiBotCount(n)}
                >{n}</button>
              ))}
            </div>
          </div>
          <button className="btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={launchAI}>
            Lancer
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Creer une partie</h2>
        <div className="row">
          <input
            placeholder="Nom de la salle"
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
          }}>Creer</button>
        </div>
      </div>

      <div className="panel">
        <h2>Rejoindre par code</h2>
        <div className="row">
          <input
            placeholder="Code de la salle"
            value={joinId}
            onChange={(e) => setJoinId(e.target.value.toUpperCase())}
            maxLength={6}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && joinId) socket.emit('room:join', { playerName, roomId: joinId });
            }}
          />
          <button onClick={() => {
            if (joinId) socket.emit('room:join', { playerName, roomId: joinId });
          }}>Rejoindre</button>
        </div>
      </div>

      {rooms.filter(r => r.phase === 'waiting').length > 0 && (
        <div className="panel">
          <h2>Parties en cours</h2>
          <ul className="room-list">
            {rooms.filter(r => r.phase === 'waiting').map(r => (
              <li key={r.id}>
                <span><strong>{r.name}</strong> — {r.players.length}/{r.maxPlayers}</span>
                <button className="small" onClick={() => socket.emit('room:join', { playerName, roomId: r.id })}>
                  Rejoindre
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
