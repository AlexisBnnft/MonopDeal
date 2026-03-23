import { socket } from '../socket/index.ts';
import { useStore } from '../store/useStore.ts';

export function Room() {
  const { currentRoom, playerName } = useStore();
  if (!currentRoom) return null;

  const isHost = currentRoom.hostId === socket.id;
  const canStart = isHost && currentRoom.players.length >= 2;

  return (
    <div className="center-screen">
      <div className="logo-small">MONOPOLY DEAL</div>
      <h1>{currentRoom.name}</h1>
      <p className="subtitle">Code : <strong className="code">{currentRoom.id}</strong></p>

      <div className="panel">
        <h2>Joueurs ({currentRoom.players.length}/{currentRoom.maxPlayers})</h2>
        <ul className="player-list">
          {currentRoom.players.map((p) => (
            <li key={p.id} className={p.connected ? '' : 'disconnected'}>
              {p.name}
              {p.id === currentRoom.hostId && <span className="badge host">Hote</span>}
              {p.name === playerName && <span className="badge you">Toi</span>}
              {p.isBot && <span className="badge bot">IA</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="row center">
        {canStart && (
          <button className="btn-primary" onClick={() => socket.emit('game:start')}>
            Lancer la partie
          </button>
        )}
        {isHost && !canStart && <p className="hint">En attente de joueurs...</p>}
        <button className="btn-secondary" onClick={() => socket.emit('room:leave')}>Quitter</button>
      </div>
    </div>
  );
}
