import { useState } from 'react';
import { socket } from '../socket/index.ts';
import { useStore } from '../store/useStore.ts';
import { COLOR_HEX, SET_SIZE, type AnyCard, type PropertyColor, type PropertySet, type Player, type PendingAction } from '@monopoly-deal/shared';

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

  // Am I a target of a pending action?
  const pendingForMe = gameState.pendingAction &&
    gameState.pendingAction.targetPlayerIds.includes(myId!) &&
    !gameState.pendingAction.respondedPlayerIds.includes(myId!);

  return (
    <div className="game-screen">
      {/* Winner overlay */}
      {gameState.phase === 'finished' && (
        <div className="overlay">
          <div className="winner-box">
            <h1>{gameState.winnerId === myId ? 'YOU WIN!' : `${gameState.players.find(p => p.id === gameState.winnerId)?.name} wins!`}</h1>
            <button onClick={() => socket.emit('room:leave')}>Back to Lobby</button>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="game-topbar">
        <span>{currentRoom?.name}</span>
        <span>Turn {gameState.turnNumber}</span>
        <span className={isMyTurn ? 'your-turn' : ''}>
          {isMyTurn ? `YOUR TURN` : `${currentPlayer?.name}'s turn`}
          {isMyTurn && gameState.turnPhase === 'action' && ` (${gameState.actionsRemaining} actions)`}
          {isMyTurn && gameState.turnPhase === 'draw' && ` - Draw cards!`}
          {isMyTurn && gameState.turnPhase === 'discard' && ` - Discard to 7`}
        </span>
      </div>

      <div className="game-body">
        {/* Left: opponents */}
        <div className="game-left">
          {opponents.map(p => (
            <OpponentPanel key={p.id} player={p} isActive={p.id === currentPlayer?.id} />
          ))}
        </div>

        {/* Center: piles + my properties */}
        <div className="game-center">
          <div className="piles">
            <div className="pile draw-pile">
              <div className="pile-label">Draw</div>
              <div className="pile-count">{gameState.drawPileCount}</div>
            </div>
            <div className="pile discard-pile">
              <div className="pile-label">Discard</div>
              <div className="pile-count">{gameState.discardPile.length}</div>
            </div>
          </div>

          {/* My properties */}
          {me && (
            <div className="my-properties">
              <h3>My Properties</h3>
              <div className="property-sets">
                {me.propertySets.map((set, i) => (
                  <PropertySetDisplay key={i} set={set} />
                ))}
                {me.propertySets.length === 0 && <div className="empty-text">No properties yet</div>}
              </div>
            </div>
          )}

          {/* My bank */}
          {me && (
            <div className="my-bank">
              <h3>Bank (${me.bank.reduce((s, c) => s + c.value, 0)}M)</h3>
              <div className="bank-cards">
                {me.bank.map(c => (
                  <span key={c.id} className="bank-card">${c.value}M</span>
                ))}
                {me.bank.length === 0 && <span className="empty-text">Empty</span>}
              </div>
            </div>
          )}

          {/* Notifications */}
          <div className="notif-log">
            {notifications.slice(-4).map((msg, i) => (
              <div key={i} className="notif">{msg}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Pending action response */}
      {pendingForMe && gameState.pendingAction && (
        <PendingActionBar action={gameState.pendingAction} myId={myId!} me={me!} />
      )}

      {/* Player hand + actions */}
      <div className="player-area">
        <div className="hand">
          {hand.map((card) => (
            <CardInHand
              key={card.id}
              card={card}
              selected={card.id === selectedCardId}
              onClick={() => setSelectedCardId(card.id === selectedCardId ? null : card.id)}
            />
          ))}
          {hand.length === 0 && <div className="empty-text">No cards in hand</div>}
        </div>

        <div className="action-bar">
          {isMyTurn && gameState.turnPhase === 'draw' && (
            <button className="btn-action" onClick={() => socket.emit('game:draw')}>
              Draw 2 Cards
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
              Discard {selectedCard.name}
            </button>
          )}

          {isMyTurn && gameState.turnPhase === 'action' && (
            <button className="btn-secondary" onClick={() => socket.emit('game:end-turn')}>
              End Turn
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function CardInHand({ card, selected, onClick }: { card: AnyCard; selected: boolean; onClick: () => void }) {
  const borderColor = card.type === 'money' ? '#4ecdc4'
    : card.type === 'property' ? COLOR_HEX[card.color]
    : card.type === 'property_wildcard' ? (card.colors === 'all' ? '#fff' : COLOR_HEX[card.colors[0]])
    : card.type === 'rent' ? '#e74c3c'
    : '#f39c12';

  return (
    <div
      className={`card-hand ${selected ? 'selected' : ''}`}
      style={{ borderColor }}
      onClick={onClick}
    >
      <div className="card-name">{card.name}</div>
      <div className="card-value">${card.value}M</div>
      <div className="card-type">{card.type.replace('_', ' ')}</div>
    </div>
  );
}

function PropertySetDisplay({ set }: { set: PropertySet }) {
  const needed = SET_SIZE[set.color];
  const propCount = set.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length;

  return (
    <div className={`prop-set ${set.isComplete ? 'complete' : ''}`} style={{ borderColor: COLOR_HEX[set.color] }}>
      <div className="prop-set-header" style={{ background: COLOR_HEX[set.color] }}>
        {set.color.replace('_', ' ')} ({propCount}/{needed})
        {set.hasHouse && ' +H'}
        {set.hasHotel && ' +Ho'}
      </div>
      <div className="prop-set-cards">
        {set.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').map(c => (
          <div key={c.id} className="prop-card-mini">{c.name}</div>
        ))}
      </div>
    </div>
  );
}

function OpponentPanel({ player, isActive }: { player: Player; isActive: boolean }) {
  const completeSets = player.propertySets.filter(s => s.isComplete).length;

  return (
    <div className={`opponent ${isActive ? 'active' : ''} ${!player.connected ? 'disconnected' : ''}`}>
      <div className="opp-header">
        <strong>{player.name}</strong>
        <span>{player.handCount} cards</span>
      </div>
      <div className="opp-info">
        <span>Bank: ${player.bank.reduce((s, c) => s + c.value, 0)}M</span>
        <span>Sets: {completeSets}/3</span>
      </div>
      <div className="opp-sets">
        {player.propertySets.map((set, i) => (
          <div
            key={i}
            className={`opp-set-dot ${set.isComplete ? 'complete' : ''}`}
            style={{ background: COLOR_HEX[set.color] }}
            title={`${set.color} (${set.cards.length}/${SET_SIZE[set.color]})`}
          />
        ))}
      </div>
    </div>
  );
}

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
      {/* Bank as money — always available */}
      <button className="btn-action" onClick={() => onPlay({ asMoney: true })}>
        Bank ${card.value}M
      </button>

      {/* Property: play to board */}
      {card.type === 'property' && (
        <button className="btn-action" onClick={() => onPlay({})}>
          Play {card.name}
        </button>
      )}

      {/* Wildcard: choose color */}
      {card.type === 'property_wildcard' && (
        <div className="action-group">
          {(card.colors === 'all' ? (['brown','blue','green','light_blue','orange','pink','railroad','red','yellow','utility'] as PropertyColor[]) : card.colors).map(c => (
            <button key={c} className="btn-color" style={{ background: COLOR_HEX[c] }}
              onClick={() => onPlay({ color: c })}>
              {c.replace('_', ' ')}
            </button>
          ))}
        </div>
      )}

      {/* Money: just bank */}
      {card.type === 'money' && null /* bank button above is enough */}

      {/* Action cards */}
      {card.type === 'action' && card.actionType === 'pass_go' && (
        <button className="btn-action" onClick={() => onPlay({})}>Play Pass Go (draw 2)</button>
      )}

      {card.type === 'action' && card.actionType === 'debt_collector' && (
        <div className="action-group">
          <select value={targetPlayer} onChange={e => setTargetPlayer(e.target.value)}>
            <option value="">Select target</option>
            {opponents.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {targetPlayer && (
            <button className="btn-action" onClick={() => onPlay({ targetPlayerId: targetPlayer })}>
              Collect $5M
            </button>
          )}
        </div>
      )}

      {card.type === 'action' && card.actionType === 'its_my_birthday' && (
        <button className="btn-action" onClick={() => onPlay({})}>It's My Birthday!</button>
      )}

      {card.type === 'action' && card.actionType === 'deal_breaker' && (
        <div className="action-group">
          <select value={targetPlayer} onChange={e => { setTargetPlayer(e.target.value); setTargetColor(''); }}>
            <option value="">Select target</option>
            {opponents.filter(p => p.propertySets.some(s => s.isComplete)).map(p =>
              <option key={p.id} value={p.id}>{p.name}</option>
            )}
          </select>
          {targetPlayer && (
            <select value={targetColor} onChange={e => setTargetColor(e.target.value as PropertyColor)}>
              <option value="">Select set</option>
              {opponents.find(p => p.id === targetPlayer)?.propertySets.filter(s => s.isComplete).map(s =>
                <option key={s.color} value={s.color}>{s.color.replace('_', ' ')}</option>
              )}
            </select>
          )}
          {targetPlayer && targetColor && (
            <button className="btn-action" onClick={() => onPlay({ targetPlayerId: targetPlayer, targetSetColor: targetColor })}>
              Steal Set!
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
              Add to {s.color.replace('_', ' ')}
            </button>
          ))}
          {mySets.filter(s => s.isComplete && !s.hasHouse).length === 0 && (
            <span className="hint">No complete set without a house</span>
          )}
        </div>
      )}

      {card.type === 'action' && card.actionType === 'hotel' && (
        <div className="action-group">
          {mySets.filter(s => s.isComplete && s.hasHouse && !s.hasHotel).map(s => (
            <button key={s.color} className="btn-color" style={{ background: COLOR_HEX[s.color] }}
              onClick={() => onPlay({ color: s.color })}>
              Add to {s.color.replace('_', ' ')}
            </button>
          ))}
          {mySets.filter(s => s.isComplete && s.hasHouse && !s.hasHotel).length === 0 && (
            <span className="hint">No complete set with house</span>
          )}
        </div>
      )}

      {/* Rent cards */}
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
        <option value="">Select target</option>
        {opponents.filter(p => p.propertySets.some(s => !s.isComplete && s.cards.length > 0)).map(p =>
          <option key={p.id} value={p.id}>{p.name}</option>
        )}
      </select>
      {target && stealableCards.length > 0 && (
        <select value={cardId} onChange={e => setCardId(e.target.value)}>
          <option value="">Select card</option>
          {stealableCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      {cardId && (
        <button className="btn-action" onClick={() => onPlay({ targetPlayerId: target, targetCardId: cardId })}>
          Steal!
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
        <option value="">Select target</option>
        {opponents.filter(p => p.propertySets.some(s => !s.isComplete)).map(p =>
          <option key={p.id} value={p.id}>{p.name}</option>
        )}
      </select>
      {target && (
        <select value={theirCard} onChange={e => setTheirCard(e.target.value)}>
          <option value="">Their card</option>
          {theirCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      {theirCard && (
        <select value={myCard} onChange={e => setMyCard(e.target.value)}>
          <option value="">Your card</option>
          {myCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      {theirCard && myCard && (
        <button className="btn-action" onClick={() => onPlay({ targetPlayerId: target, targetCardId: theirCard, offeredCardId: myCard })}>
          Swap!
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

  return (
    <div className="action-group">
      <select value={color} onChange={e => setColor(e.target.value as PropertyColor)}>
        <option value="">Select color</option>
        {availableColors.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
      </select>
      {isWild && color && (
        <select value={target} onChange={e => setTarget(e.target.value)}>
          <option value="">Select target</option>
          {opponents.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      {color && (!isWild || target) && (
        <button className="btn-action" onClick={() => onPlay({
          color,
          ...(isWild ? { targetPlayerId: target } : {}),
        })}>
          Charge Rent!
        </button>
      )}
    </div>
  );
}

function PendingActionBar({ action, myId, me }: { action: PendingAction; myId: string; me: Player }) {
  const [selectedPayment, setSelectedPayment] = useState<string[]>([]);

  const needsPayment = action.type === 'rent' || action.type === 'debt_collector' || action.type === 'its_my_birthday';

  // All payable cards: bank + property cards
  const payableCards: { id: string; name: string; value: number; source: string }[] = [];
  for (const card of me.bank) {
    payableCards.push({ id: card.id, name: `$${card.value}M (bank)`, value: card.value, source: 'bank' });
  }
  for (const set of me.propertySets) {
    for (const card of set.cards) {
      payableCards.push({ id: card.id, name: `${card.name} ($${card.value}M)`, value: card.value, source: set.color });
    }
  }

  const selectedTotal = payableCards
    .filter(c => selectedPayment.includes(c.id))
    .reduce((s, c) => s + c.value, 0);

  const hasJustSayNo = false; // We don't see our hand cards here, check from hand
  // Actually we check hand via the hand in store
  const hand = useStore.getState().hand;
  const hasJSN = hand.some(c => c.type === 'action' && c.actionType === 'just_say_no');

  return (
    <div className="pending-bar">
      <div className="pending-info">
        {action.type === 'rent' && `You owe $${action.amount}M rent!`}
        {action.type === 'debt_collector' && `You owe $${action.amount}M!`}
        {action.type === 'its_my_birthday' && `Pay $${action.amount}M for their birthday!`}
        {action.type === 'deal_breaker' && `They want to steal your ${action.targetSetColor} set!`}
        {action.type === 'sly_deal' && `They want to steal one of your properties!`}
        {action.type === 'forced_deal' && `They want to swap a property!`}
      </div>

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
                {c.name}
              </label>
            ))}
          </div>
          <div className="payment-total">
            Selected: ${selectedTotal}M / ${action.amount}M needed
          </div>
        </div>
      )}

      <div className="pending-actions">
        <button
          className="btn-action"
          disabled={needsPayment && selectedTotal < (action.amount || 0) && payableCards.length > 0}
          onClick={() => socket.emit('game:respond', { accept: true, paymentCardIds: selectedPayment })}
        >
          {needsPayment ? `Pay $${selectedTotal}M` : 'Accept'}
        </button>

        {hasJSN && (
          <button className="btn-danger" onClick={() => socket.emit('game:respond', { accept: false })}>
            Just Say No!
          </button>
        )}
      </div>
    </div>
  );
}
