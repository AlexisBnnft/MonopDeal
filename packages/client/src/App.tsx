import { useSocket } from './hooks/useSocket.ts';
import { useStore } from './store/useStore.ts';
import { Lobby } from './pages/Lobby.tsx';
import { Room } from './pages/Room.tsx';
import { Game } from './pages/Game.tsx';

export function App() {
  useSocket();
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
    <div className="center-screen">
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
