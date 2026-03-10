import { useState } from 'react';
import { socket } from '../socket/index.ts';
import { useStore } from '../store/useStore.ts';
import { COLOR_HEX, COLOR_NAMES, SET_SIZE, RENT_VALUES, type AnyCard, type PropertyColor, type PropertySet, type Player, type PendingAction } from '@monopoly-deal/shared';

export function Game() {
  const { gameState, hand, notifications, currentRoom } = useStore();
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  if (!gameState) return null;

  const myId = socket.id;
  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  const isMyTurn = currentPlayer?.id === myId;
  const me = gameState.players.find(p => p.id === myId);
  const opponents = gameState.players.filter(p => p.id !== myId);
  const selectedCard = hand.find(c => c.id === selectedCardId);

  const pendingForMe = gameState.pendingAction &&
    gameState.pendingAction.targetPlayerIds.includes(myId!) &&
    !gameState.pendingAction.respondedPlayerIds.includes(myId!);

  return (
    <div className="game-screen">
      {gameState.phase === 'finished' && (
        <div className="overlay">
          <div className="winner-box">
            <h1>{gameState.winnerId === myId ? 'VICTOIRE !' : `${gameState.players.find(p => p.id === gameState.winnerId)?.name} a gagne !`}</h1>
            <button onClick={() => socket.emit('room:leave')}>Retour au lobby</button>
          </div>
        </div>
      )}

      <div className="game-topbar">
        <span>{currentRoom?.name}</span>
        <span>Tour {gameState.turnNumber}</span>
        <span className={isMyTurn ? 'your-turn' : ''}>
          {isMyTurn ? 'TON TOUR' : `Tour de ${currentPlayer?.name}`}
          {isMyTurn && gameState.turnPhase === 'action' && ` — ${gameState.actionsRemaining} action${gameState.actionsRemaining > 1 ? 's' : ''}`}
          {isMyTurn && gameState.turnPhase === 'draw' && ' — Pioche tes cartes !'}
          {isMyTurn && gameState.turnPhase === 'discard' && ' — Defausse jusqu\'a 7 cartes'}
        </span>
      </div>

      <div className="game-body">
        <div className="game-left">
          {opponents.map(p => (
            <OpponentPanel key={p.id} player={p} isActive={p.id === currentPlayer?.id} />
          ))}
        </div>

        <div className="game-center">
          <div className="center-top-row">
            <div className="piles">
              <div className="pile draw-pile">
                <div className="pile-label">Pioche</div>
                <div className="pile-count">{gameState.drawPileCount}</div>
              </div>
              <div className="pile discard-pile">
                <div className="pile-label">Defausse</div>
                <div className="pile-count">{gameState.discardPile.length}</div>
                {gameState.discardPile.length > 0 && (
                  <div className="pile-top">{gameState.discardPile[gameState.discardPile.length - 1].name}</div>
                )}
              </div>
            </div>

            {me && (
              <div className="my-bank">
                <h3>Banque ({me.bank.reduce((s, c) => s + c.value, 0)}M)</h3>
                <div className="bank-cards">
                  {me.bank.map(c => (
                    <span key={c.id} className="bank-card" title={c.description}>{c.name}</span>
                  ))}
                  {me.bank.length === 0 && <span className="empty-text">Vide</span>}
                </div>
              </div>
            )}
          </div>

          {me && (
            <div className="my-properties">
              <h3>Mes Proprietes ({me.propertySets.filter(s => s.isComplete).length}/3 sets complets)</h3>
              <div className="property-sets">
                {me.propertySets.map((set, i) => (
                  <PropertySetDisplay key={i} set={set} detailed />
                ))}
                {me.propertySets.length === 0 && <div className="empty-text">Aucune propriete</div>}
              </div>
            </div>
          )}

          <div className="notif-log">
            {notifications.slice(-5).map((msg, i) => (
              <div key={i} className="notif">{msg}</div>
            ))}
          </div>
        </div>
      </div>

      {pendingForMe && gameState.pendingAction && (
        <PendingActionBar action={gameState.pendingAction} myId={myId!} me={me!} />
      )}

      <div className="player-area">
        <div className="hand">
          {hand.map((card) => (
            <GameCard
              key={card.id}
              card={card}
              selected={card.id === selectedCardId}
              onClick={() => setSelectedCardId(card.id === selectedCardId ? null : card.id)}
            />
          ))}
          {hand.length === 0 && <div className="empty-text">Pas de cartes en main</div>}
        </div>

        <div className="action-bar">
          {isMyTurn && gameState.turnPhase === 'draw' && (
            <button className="btn-action" onClick={() => socket.emit('game:draw')}>
              Piocher 2 cartes
            </button>
          )}

          {isMyTurn && gameState.turnPhase === 'action' && selectedCard && (
            <CardActions
              card={selectedCard}
              opponents={opponents}
              mySets={me?.propertySets || []}
              onPlay={(opts) => {
                socket.emit('game:play-card', { cardId: selectedCard.id, ...opts });
                setSelectedCardId(null);
              }}
            />
          )}

          {isMyTurn && gameState.turnPhase === 'discard' && selectedCard && (
            <button className="btn-action" onClick={() => {
              socket.emit('game:discard', { cardIds: [selectedCard.id] });
              setSelectedCardId(null);
            }}>
              Defausser {selectedCard.name}
            </button>
          )}

          {isMyTurn && gameState.turnPhase === 'action' && (
            <button className="btn-secondary" onClick={() => socket.emit('game:end-turn')}>
              Fin du tour
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Game Card (like real Monopoly Deal cards) ──────────────────────────────

function GameCard({ card, selected, onClick }: { card: AnyCard; selected: boolean; onClick: () => void }) {
  if (card.type === 'property') return <PropertyCardView card={card} selected={selected} onClick={onClick} />;
  if (card.type === 'property_wildcard') return <WildcardCardView card={card} selected={selected} onClick={onClick} />;
  if (card.type === 'money') return <MoneyCardView card={card} selected={selected} onClick={onClick} />;
  if (card.type === 'action') return <ActionCardView card={card} selected={selected} onClick={onClick} />;
  if (card.type === 'rent') return <RentCardView card={card} selected={selected} onClick={onClick} />;
  return null;
}

function PropertyCardView({ card, selected, onClick }: { card: AnyCard & { color: PropertyColor }; selected: boolean; onClick: () => void }) {
  const rents = RENT_VALUES[card.color];
  const setSize = SET_SIZE[card.color];

  return (
    <div className={`game-card ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="gc-color-band" style={{ background: COLOR_HEX[card.color] }}>
        <span className="gc-color-name">{COLOR_NAMES[card.color]}</span>
        <span className="gc-set-size">{setSize} pour le set</span>
      </div>
      <div className="gc-body">
        <div className="gc-title">{card.name}</div>
        <div className="gc-rent-table">
          {rents.map((r, i) => (
            <div key={i} className="gc-rent-row">
              <span className="gc-rent-dots">
                {Array.from({ length: i + 1 }, (_, j) => (
                  <span key={j} className="gc-dot" style={{ background: COLOR_HEX[card.color] }} />
                ))}
              </span>
              <span className="gc-rent-val">{r}M</span>
            </div>
          ))}
          <div className="gc-rent-row bonus-row">
            <span>+ Maison</span><span className="gc-rent-val">+3M</span>
          </div>
          <div className="gc-rent-row bonus-row">
            <span>+ Hotel</span><span className="gc-rent-val">+4M</span>
          </div>
        </div>
      </div>
      <div className="gc-footer">
        <span className="gc-value">{card.value}M</span>
      </div>
    </div>
  );
}

function WildcardCardView({ card, selected, onClick }: { card: AnyCard & { colors: [PropertyColor, PropertyColor] | 'all'; currentColor: PropertyColor }; selected: boolean; onClick: () => void }) {
  const isUniversal = card.colors === 'all';

  return (
    <div className={`game-card wildcard ${selected ? 'selected' : ''}`} onClick={onClick}>
      {isUniversal ? (
        <div className="gc-color-band gc-rainbow">
          <span className="gc-color-name">JOKER</span>
          <span className="gc-set-size">Toute couleur</span>
        </div>
      ) : (
        <div className="gc-color-band gc-split">
          <div className="gc-split-half" style={{ background: COLOR_HEX[card.colors[0]] }} />
          <div className="gc-split-half" style={{ background: COLOR_HEX[card.colors[1]] }} />
          <span className="gc-color-name gc-split-label">JOKER</span>
        </div>
      )}
      <div className="gc-body">
        <div className="gc-title">{card.name}</div>
        <div className="gc-desc">{card.description}</div>
        {!isUniversal && (
          <div className="gc-wildcard-colors">
            <div className="gc-wc-option" style={{ borderColor: COLOR_HEX[card.colors[0]] }}>
              {COLOR_NAMES[card.colors[0]]}
            </div>
            <div className="gc-wc-option" style={{ borderColor: COLOR_HEX[card.colors[1]] }}>
              {COLOR_NAMES[card.colors[1]]}
            </div>
          </div>
        )}
      </div>
      <div className="gc-footer">
        <span className="gc-value">{card.value}M</span>
      </div>
    </div>
  );
}

function MoneyCardView({ card, selected, onClick }: { card: AnyCard; selected: boolean; onClick: () => void }) {
  return (
    <div className={`game-card money-card ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="gc-color-band gc-money-band">
        <span className="gc-color-name">ARGENT</span>
      </div>
      <div className="gc-body gc-money-body">
        <div className="gc-money-amount">{card.value}M</div>
        <div className="gc-money-sub">Placer dans la banque</div>
      </div>
      <div className="gc-footer">
        <span className="gc-value">{card.value}M</span>
      </div>
    </div>
  );
}

function ActionCardView({ card, selected, onClick }: { card: AnyCard & { actionType: string }; selected: boolean; onClick: () => void }) {
  const actionColors: Record<string, string> = {
    pass_go: '#3498db',
    deal_breaker: '#8e44ad',
    just_say_no: '#e74c3c',
    sly_deal: '#2ecc71',
    forced_deal: '#e67e22',
    debt_collector: '#1abc9c',
    its_my_birthday: '#f1c40f',
    house: '#27ae60',
    hotel: '#c0392b',
    double_the_rent: '#9b59b6',
  };
  const bg = actionColors[card.actionType] || '#f39c12';

  return (
    <div className={`game-card action-card ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="gc-color-band" style={{ background: bg }}>
        <span className="gc-color-name">ACTION</span>
      </div>
      <div className="gc-body">
        <div className="gc-title gc-action-title">{card.name}</div>
        <div className="gc-desc">{card.description}</div>
      </div>
      <div className="gc-footer">
        <span className="gc-value">{card.value}M</span>
      </div>
    </div>
  );
}

function RentCardView({ card, selected, onClick }: { card: AnyCard & { colors: [PropertyColor, PropertyColor] | 'all' }; selected: boolean; onClick: () => void }) {
  const isWild = card.colors === 'all';

  return (
    <div className={`game-card rent-card ${selected ? 'selected' : ''}`} onClick={onClick}>
      {isWild ? (
        <div className="gc-color-band gc-rainbow">
          <span className="gc-color-name">LOYER</span>
          <span className="gc-set-size">1 joueur au choix</span>
        </div>
      ) : (
        <div className="gc-color-band gc-split">
          <div className="gc-split-half" style={{ background: COLOR_HEX[card.colors[0]] }} />
          <div className="gc-split-half" style={{ background: COLOR_HEX[card.colors[1]] }} />
          <span className="gc-color-name gc-split-label">LOYER</span>
        </div>
      )}
      <div className="gc-body">
        <div className="gc-title">{card.name}</div>
        <div className="gc-desc">{card.description}</div>
        {!isWild && (
          <div className="gc-rent-preview">
            {card.colors.map(color => (
              <div key={color} className="gc-rent-mini">
                <div className="gc-rent-mini-label" style={{ color: COLOR_HEX[color] }}>{COLOR_NAMES[color]}</div>
                <div className="gc-rent-mini-vals">
                  {RENT_VALUES[color].map((r, i) => (
                    <span key={i}>{i + 1}={r}M</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="gc-footer">
        <span className="gc-value">{card.value}M</span>
      </div>
    </div>
  );
}

// ─── Property Set Display ───────────────────────────────────────────────────

function PropertySetDisplay({ set, detailed }: { set: PropertySet; detailed?: boolean }) {
  const needed = SET_SIZE[set.color];
  const propCount = set.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length;

  const rentIdx = Math.min(propCount, RENT_VALUES[set.color].length) - 1;
  let currentRent = rentIdx >= 0 ? RENT_VALUES[set.color][rentIdx] : 0;
  if (set.hasHouse) currentRent += 3;
  if (set.hasHotel) currentRent += 4;

  return (
    <div className={`prop-set ${set.isComplete ? 'complete' : ''}`} style={{ borderColor: COLOR_HEX[set.color] }}>
      <div className="prop-set-header" style={{ background: COLOR_HEX[set.color] }}>
        <span>{COLOR_NAMES[set.color]} ({propCount}/{needed})</span>
        <span className="rent-badge">Loyer: {currentRent}M</span>
      </div>
      <div className="prop-set-cards">
        {set.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').map(c => (
          <div key={c.id} className="prop-card-mini" title={c.description}>
            {c.name}
            {c.type === 'property_wildcard' && <span className="wild-tag">Joker</span>}
          </div>
        ))}
        {set.hasHouse && <div className="prop-bonus">+ Maison (+3M)</div>}
        {set.hasHotel && <div className="prop-bonus">+ Hotel (+4M)</div>}
      </div>
      {/* Rent table on my sets */}
      {detailed && (
        <div className="prop-set-rents">
          {RENT_VALUES[set.color].map((r, i) => (
            <span key={i} className={`psr-val ${i + 1 <= propCount ? 'active' : ''}`}>
              {i + 1}: {r}M
            </span>
          ))}
        </div>
      )}
      {detailed && set.isComplete && (
        <div className="set-complete-tag">SET COMPLET</div>
      )}
    </div>
  );
}

// ─── Opponent Panel ─────────────────────────────────────────────────────────

function OpponentPanel({ player, isActive }: { player: Player; isActive: boolean }) {
  const completeSets = player.propertySets.filter(s => s.isComplete).length;
  const bankTotal = player.bank.reduce((s, c) => s + c.value, 0);

  return (
    <div className={`opponent ${isActive ? 'active' : ''} ${!player.connected ? 'disconnected' : ''}`}>
      <div className="opp-header">
        <strong>{player.name}</strong>
        <span>{player.handCount} cartes</span>
      </div>
      <div className="opp-info">
        <span>Banque: {bankTotal}M</span>
        <span>Sets: {completeSets}/3</span>
      </div>
      <div className="opp-sets">
        {player.propertySets.map((set, i) => {
          const propCount = set.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length;
          return (
            <div
              key={i}
              className={`opp-set-pill ${set.isComplete ? 'complete' : ''}`}
              style={{ background: COLOR_HEX[set.color] }}
              title={`${COLOR_NAMES[set.color]} (${propCount}/${SET_SIZE[set.color]})${set.hasHouse ? ' +Maison' : ''}${set.hasHotel ? ' +Hotel' : ''}`}
            >
              {COLOR_NAMES[set.color].slice(0, 3)} {propCount}/{SET_SIZE[set.color]}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Card Actions ───────────────────────────────────────────────────────────

function CardActions({ card, opponents, mySets, onPlay }: {
  card: AnyCard;
  opponents: Player[];
  mySets: PropertySet[];
  onPlay: (opts: Record<string, any>) => void;
}) {
  const [targetPlayer, setTargetPlayer] = useState<string>('');
  const [targetColor, setTargetColor] = useState<PropertyColor | ''>('');

  return (
    <div className="card-actions">
      <button className="btn-bank" onClick={() => onPlay({ asMoney: true })}>
        Banquer ({card.value}M)
      </button>

      {card.type === 'property' && (
        <button className="btn-action" onClick={() => onPlay({})}>
          Poser {card.name}
        </button>
      )}

      {card.type === 'property_wildcard' && (
        <div className="action-group">
          {(card.colors === 'all'
            ? (['brown','blue','green','light_blue','orange','pink','railroad','red','yellow','utility'] as PropertyColor[])
            : card.colors
          ).map(c => (
            <button key={c} className="btn-color" style={{ background: COLOR_HEX[c] }}
              onClick={() => onPlay({ color: c })}>
              {COLOR_NAMES[c]}
            </button>
          ))}
        </div>
      )}

      {card.type === 'action' && card.actionType === 'pass_go' && (
        <button className="btn-action" onClick={() => onPlay({})}>Jouer (piocher 2)</button>
      )}

      {card.type === 'action' && card.actionType === 'debt_collector' && (
        <div className="action-group">
          <select value={targetPlayer} onChange={e => setTargetPlayer(e.target.value)}>
            <option value="">Choisir un joueur</option>
            {opponents.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {targetPlayer && (
            <button className="btn-action" onClick={() => onPlay({ targetPlayerId: targetPlayer })}>
              Reclamer 5M
            </button>
          )}
        </div>
      )}

      {card.type === 'action' && card.actionType === 'its_my_birthday' && (
        <button className="btn-action" onClick={() => onPlay({})}>C'est mon anniversaire !</button>
      )}

      {card.type === 'action' && card.actionType === 'deal_breaker' && (
        <div className="action-group">
          <select value={targetPlayer} onChange={e => { setTargetPlayer(e.target.value); setTargetColor(''); }}>
            <option value="">Choisir un joueur</option>
            {opponents.filter(p => p.propertySets.some(s => s.isComplete)).map(p =>
              <option key={p.id} value={p.id}>{p.name}</option>
            )}
          </select>
          {targetPlayer && (
            <select value={targetColor} onChange={e => setTargetColor(e.target.value as PropertyColor)}>
              <option value="">Choisir le set</option>
              {opponents.find(p => p.id === targetPlayer)?.propertySets.filter(s => s.isComplete).map(s =>
                <option key={s.color} value={s.color}>{COLOR_NAMES[s.color]}</option>
              )}
            </select>
          )}
          {targetPlayer && targetColor && (
            <button className="btn-action" onClick={() => onPlay({ targetPlayerId: targetPlayer, targetSetColor: targetColor })}>
              Voler le set !
            </button>
          )}
        </div>
      )}

      {card.type === 'action' && card.actionType === 'sly_deal' && (
        <SlyDealAction opponents={opponents} onPlay={onPlay} />
      )}

      {card.type === 'action' && card.actionType === 'forced_deal' && (
        <ForcedDealAction opponents={opponents} mySets={mySets} onPlay={onPlay} />
      )}

      {card.type === 'action' && card.actionType === 'house' && (
        <div className="action-group">
          {mySets.filter(s => s.isComplete && !s.hasHouse).map(s => (
            <button key={s.color} className="btn-color" style={{ background: COLOR_HEX[s.color] }}
              onClick={() => onPlay({ color: s.color })}>
              {COLOR_NAMES[s.color]}
            </button>
          ))}
          {mySets.filter(s => s.isComplete && !s.hasHouse).length === 0 && (
            <span className="hint">Aucun set complet sans maison</span>
          )}
        </div>
      )}

      {card.type === 'action' && card.actionType === 'hotel' && (
        <div className="action-group">
          {mySets.filter(s => s.isComplete && s.hasHouse && !s.hasHotel).map(s => (
            <button key={s.color} className="btn-color" style={{ background: COLOR_HEX[s.color] }}
              onClick={() => onPlay({ color: s.color })}>
              {COLOR_NAMES[s.color]}
            </button>
          ))}
          {mySets.filter(s => s.isComplete && s.hasHouse && !s.hasHotel).length === 0 && (
            <span className="hint">Aucun set avec maison</span>
          )}
        </div>
      )}

      {card.type === 'rent' && (
        <RentAction card={card} opponents={opponents} mySets={mySets} onPlay={onPlay} />
      )}
    </div>
  );
}

function SlyDealAction({ opponents, onPlay }: { opponents: Player[]; onPlay: (opts: Record<string, any>) => void }) {
  const [target, setTarget] = useState('');
  const [cardId, setCardId] = useState('');

  const targetPlayer = opponents.find(p => p.id === target);
  const stealableCards = targetPlayer?.propertySets
    .filter(s => !s.isComplete)
    .flatMap(s => s.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard')) || [];

  return (
    <div className="action-group">
      <select value={target} onChange={e => { setTarget(e.target.value); setCardId(''); }}>
        <option value="">Choisir un joueur</option>
        {opponents.filter(p => p.propertySets.some(s => !s.isComplete && s.cards.length > 0)).map(p =>
          <option key={p.id} value={p.id}>{p.name}</option>
        )}
      </select>
      {target && stealableCards.length > 0 && (
        <select value={cardId} onChange={e => setCardId(e.target.value)}>
          <option value="">Choisir la propriete</option>
          {stealableCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      {cardId && (
        <button className="btn-action" onClick={() => onPlay({ targetPlayerId: target, targetCardId: cardId })}>
          Voler !
        </button>
      )}
    </div>
  );
}

function ForcedDealAction({ opponents, mySets, onPlay }: { opponents: Player[]; mySets: PropertySet[]; onPlay: (opts: Record<string, any>) => void }) {
  const [target, setTarget] = useState('');
  const [theirCard, setTheirCard] = useState('');
  const [myCard, setMyCard] = useState('');

  const targetPlayer = opponents.find(p => p.id === target);
  const theirCards = targetPlayer?.propertySets
    .filter(s => !s.isComplete)
    .flatMap(s => s.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard')) || [];
  const myCards = mySets
    .filter(s => !s.isComplete)
    .flatMap(s => s.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard'));

  return (
    <div className="action-group">
      <select value={target} onChange={e => { setTarget(e.target.value); setTheirCard(''); }}>
        <option value="">Choisir un joueur</option>
        {opponents.filter(p => p.propertySets.some(s => !s.isComplete)).map(p =>
          <option key={p.id} value={p.id}>{p.name}</option>
        )}
      </select>
      {target && (
        <select value={theirCard} onChange={e => setTheirCard(e.target.value)}>
          <option value="">Sa propriete</option>
          {theirCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      {theirCard && (
        <select value={myCard} onChange={e => setMyCard(e.target.value)}>
          <option value="">Ta propriete</option>
          {myCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      {theirCard && myCard && (
        <button className="btn-action" onClick={() => onPlay({ targetPlayerId: target, targetCardId: theirCard, offeredCardId: myCard })}>
          Echanger !
        </button>
      )}
    </div>
  );
}

function RentAction({ card, opponents, mySets, onPlay }: {
  card: AnyCard & { colors: any }; opponents: Player[]; mySets: PropertySet[]; onPlay: (opts: Record<string, any>) => void;
}) {
  const [color, setColor] = useState<PropertyColor | ''>('');
  const [target, setTarget] = useState('');

  const availableColors = card.colors === 'all'
    ? mySets.map(s => s.color)
    : (card.colors as [PropertyColor, PropertyColor]).filter((c: PropertyColor) => mySets.some(s => s.color === c));

  const isWild = card.colors === 'all';

  const selectedSet = color ? mySets.find(s => s.color === color) : null;
  let rentPreview = 0;
  if (selectedSet) {
    const propCount = selectedSet.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length;
    const rentIdx = Math.min(propCount, RENT_VALUES[color as PropertyColor].length) - 1;
    rentPreview = rentIdx >= 0 ? RENT_VALUES[color as PropertyColor][rentIdx] : 0;
    if (selectedSet.hasHouse) rentPreview += 3;
    if (selectedSet.hasHotel) rentPreview += 4;
  }

  return (
    <div className="action-group">
      <select value={color} onChange={e => setColor(e.target.value as PropertyColor)}>
        <option value="">Choisir la couleur</option>
        {availableColors.map(c => <option key={c} value={c}>{COLOR_NAMES[c]}</option>)}
      </select>
      {isWild && color && (
        <select value={target} onChange={e => setTarget(e.target.value)}>
          <option value="">Choisir le joueur</option>
          {opponents.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      {color && (!isWild || target) && (
        <button className="btn-action" onClick={() => onPlay({
          color,
          ...(isWild ? { targetPlayerId: target } : {}),
        })}>
          Reclamer {rentPreview}M de loyer !
        </button>
      )}
    </div>
  );
}

// ─── Pending Action Bar ─────────────────────────────────────────────────────

function PendingActionBar({ action, myId, me }: { action: PendingAction; myId: string; me: Player }) {
  const [selectedPayment, setSelectedPayment] = useState<string[]>([]);

  const needsPayment = action.type === 'rent' || action.type === 'debt_collector' || action.type === 'its_my_birthday';

  const payableCards: { id: string; name: string; value: number; source: string }[] = [];
  for (const card of me.bank) {
    payableCards.push({ id: card.id, name: `${card.name} (banque)`, value: card.value, source: 'banque' });
  }
  for (const set of me.propertySets) {
    for (const card of set.cards) {
      payableCards.push({ id: card.id, name: `${card.name} (${COLOR_NAMES[set.color]})`, value: card.value, source: set.color });
    }
  }

  const selectedTotal = payableCards
    .filter(c => selectedPayment.includes(c.id))
    .reduce((s, c) => s + c.value, 0);

  const hand = useStore.getState().hand;
  const hasJSN = hand.some(c => c.type === 'action' && c.actionType === 'just_say_no');

  const actionLabels: Record<string, string> = {
    rent: `Tu dois payer ${action.amount}M de loyer !`,
    debt_collector: `Tu dois payer ${action.amount}M de dette !`,
    its_my_birthday: `Paye ${action.amount}M pour son anniversaire !`,
    deal_breaker: `Il veut voler ton set ${action.targetSetColor ? COLOR_NAMES[action.targetSetColor] : ''} complet !`,
    sly_deal: 'Il veut voler une de tes proprietes !',
    forced_deal: 'Il veut echanger une propriete avec toi !',
  };

  return (
    <div className="pending-bar">
      <div className="pending-info">{actionLabels[action.type]}</div>

      {needsPayment && (
        <div className="payment-select">
          <div className="payment-cards">
            {payableCards.map(c => (
              <label key={c.id} className={`payment-card ${selectedPayment.includes(c.id) ? 'selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={selectedPayment.includes(c.id)}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedPayment([...selectedPayment, c.id]);
                    else setSelectedPayment(selectedPayment.filter(id => id !== c.id));
                  }}
                />
                {c.name} ({c.value}M)
              </label>
            ))}
            {payableCards.length === 0 && <span className="empty-text">Tu n'as rien pour payer</span>}
          </div>
          <div className="payment-total">
            Selectionne : {selectedTotal}M / {action.amount}M requis
            {selectedTotal > (action.amount || 0) && <span className="overpay"> (pas de rendu de monnaie !)</span>}
          </div>
        </div>
      )}

      <div className="pending-actions">
        <button
          className="btn-action"
          disabled={needsPayment && selectedTotal < (action.amount || 0) && payableCards.length > 0}
          onClick={() => socket.emit('game:respond', { accept: true, paymentCardIds: selectedPayment })}
        >
          {needsPayment
            ? (payableCards.length === 0 ? 'Je n\'ai rien' : `Payer ${selectedTotal}M`)
            : 'Accepter'}
        </button>

        {hasJSN && (
          <button className="btn-danger" onClick={() => socket.emit('game:respond', { accept: false })}>
            Non merci !
          </button>
        )}
      </div>
    </div>
  );
}
