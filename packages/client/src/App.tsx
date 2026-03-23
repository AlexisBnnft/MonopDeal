import { useEffect } from 'react';
import { useSocket } from './hooks/useSocket.ts';
import { useStore } from './store/useStore.ts';
import { Lobby } from './pages/Lobby.tsx';
import { Room } from './pages/Room.tsx';
import { Game } from './pages/Game.tsx';
import { audioManager } from './audio/AudioManager.ts';
import { useGameSounds } from './audio/useGameSounds.ts';

export function App() {
  useSocket();
  useGameSounds();

  // Unlock audio on first user interaction
  useEffect(() => {
    const unlock = () => audioManager.init();
    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('touchstart', unlock, { once: true });
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('touchstart', unlock);
    };
  }, []);
  const { playerName, currentRoom, gameState, errorMsg } = useStore();

  return (
    <>
      {errorMsg && <div className="toast-error">{errorMsg}</div>}
      {!playerName ? <NameEntry /> :
        gameState?.phase === 'playing' || gameState?.phase === 'finished' ? <Game /> :
          currentRoom ? <Room /> :
            <Lobby />}
    </>
  );
}

function NameEntry() {
  const { setPlayerName } = useStore();

  return (
    <div className="center-screen name-entry">
      <div className="deco-cards" aria-hidden>
        {['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'].map((color, i) => (
          <div
            key={i}
            className="deco-card"
            style={{
              '--c': color,
              '--r': `${(i - 2) * 12}deg`,
              '--d': `${i * 0.08}s`,
            } as React.CSSProperties}
          />
        ))}
      </div>
      <div className="logo">MONOPOLY DEAL</div>
      <p className="subtitle">Le jeu de cartes</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const name = new FormData(e.currentTarget).get('name') as string;
          if (name.trim()) setPlayerName(name.trim());
        }}
      >
        <input name="name" placeholder="Ton prenom" maxLength={20} autoFocus autoComplete="off" />
        <button type="submit">Jouer</button>
      </form>
    </div>
  );
}
