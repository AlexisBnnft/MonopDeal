import { useState, useRef, useEffect } from 'react';
import {
  DndContext, DragOverlay,
  type DragStartEvent, type DragEndEvent,
  PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { socket } from '../socket/index.ts';
import { useStore } from '../store/useStore.ts';
import {
  COLOR_HEX, COLOR_NAMES, RENT_VALUES, displayName, REACTION_EMOJIS,
  type AnyCard, type PropertyColor, type PropertySet, type Player, type PendingAction,
} from '@monopoly-deal/shared';
import { CardInHand, CardGhost } from '../components/CardInHand.tsx';
import { PlayerArea } from '../components/PlayerArea.tsx';
import { PropertySetCard } from '../components/PropertySetCard.tsx';
import { DropZone } from '../components/DropZone.tsx';
import { TargetingOverlay, ColorPicker } from '../components/TargetingOverlay.tsx';
import type { TargetingState, TargetingStep } from '../components/types.ts';

export function Game() {
  const { gameState, hand, notifications, currentRoom, chatMessages, floatingReactions, removeFloatingReaction, reorderHand, sortHand } = useStore();
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [targeting, setTargeting] = useState<TargetingState | null>(null);
  const [draggedCard, setDraggedCard] = useState<AnyCard | null>(null);
  const [colorPicker, setColorPicker] = useState<{
    colors: PropertyColor[];
    label: string;
    resolve: (color: PropertyColor) => void;
  } | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [handVisible, setHandVisible] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [reactionBarOpen, setReactionBarOpen] = useState(false);
  const [swapMode, setSwapMode] = useState<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatOpen]);

  // Auto-remove floating reactions after 3s
  useEffect(() => {
    if (floatingReactions.length === 0) return;
    const latest = floatingReactions[floatingReactions.length - 1];
    const timer = setTimeout(() => removeFloatingReaction(latest.id), 3000);
    return () => clearTimeout(timer);
  }, [floatingReactions]);


  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

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

  const jsnChainForMe = gameState.pendingAction?.jsnChain?.awaitingCounterFrom === myId;

  // ─── Targeting logic ───────────────────────────────────────────────

  function startTargeting(card: AnyCard) {
    if (card.type !== 'action' && card.type !== 'rent') return null;

    let steps: TargetingStep[] = [];

    if (card.type === 'action') {
      switch (card.actionType) {
        case 'debt_collector':
          steps = [{ type: 'select_player', label: 'Choisis un joueur a qui reclamer 5M' }];
          break;
        case 'deal_breaker':
          steps = [
            { type: 'select_player', label: 'Choisis un joueur avec un set complet' },
            { type: 'select_complete_set', label: 'Choisis le set complet a voler' },
          ];
          break;
        case 'sly_deal':
          steps = [
            { type: 'select_player', label: 'Choisis un joueur a qui voler une propriete' },
            { type: 'select_incomplete_card', label: 'Choisis la propriete a voler' },
          ];
          break;
        case 'forced_deal':
          steps = [
            { type: 'select_player', label: 'Choisis un joueur pour l\'echange' },
            { type: 'select_incomplete_card', label: 'Choisis sa propriete' },
            { type: 'select_my_card', label: 'Choisis ta propriete a echanger' },
          ];
          break;
        case 'house':
          steps = [{ type: 'select_rent_color', label: 'Choisis le set pour la maison' }];
          break;
        case 'hotel':
          steps = [{ type: 'select_rent_color', label: 'Choisis le set pour l\'hotel' }];
          break;
        default:
          return null;
      }
    } else if (card.type === 'rent') {
      if (card.colors === 'all') {
        steps = [
          { type: 'select_rent_color', label: 'Choisis la couleur du loyer' },
          { type: 'select_player', label: 'Choisis le joueur (loyer universel = 1 joueur)' },
        ];
      } else {
        steps = [{ type: 'select_rent_color', label: 'Choisis la couleur du loyer' }];
      }
    }

    if (steps.length === 0) return null;

    const state: TargetingState = {
      cardId: card.id,
      actionType: card.type === 'action' ? card.actionType : 'rent',
      steps,
      currentStep: 0,
    };
    setTargeting(state);
    return state;
  }

  function advanceTargeting(update: Partial<TargetingState>) {
    setTargeting(prev => {
      if (!prev) return null;
      return { ...prev, ...update, currentStep: prev.currentStep + 1 };
    });
  }

  function handleTargetPlayer(playerId: string) {
    if (!targeting) return;
    const step = targeting.steps[targeting.currentStep];
    if (step?.type !== 'select_player') return;
    advanceTargeting({ selectedPlayerId: playerId });
  }

  function handleTargetSet(color: PropertyColor) {
    if (!targeting) return;
    const step = targeting.steps[targeting.currentStep];
    if (step?.type === 'select_complete_set' || step?.type === 'select_rent_color') {
      advanceTargeting({ selectedColor: color });
    }
  }

  function handleTargetCard(cardId: string) {
    if (!targeting) return;
    const step = targeting.steps[targeting.currentStep];
    if (step?.type === 'select_incomplete_card') {
      advanceTargeting({ selectedCardId: cardId });
    } else if (step?.type === 'select_my_card') {
      advanceTargeting({ selectedMyCardId: cardId });
    }
  }

  function confirmTargeting() {
    if (!targeting) return;
    const opts: Record<string, any> = {};

    switch (targeting.actionType) {
      case 'debt_collector':
        opts.targetPlayerId = targeting.selectedPlayerId;
        break;
      case 'deal_breaker':
        opts.targetPlayerId = targeting.selectedPlayerId;
        opts.targetSetColor = targeting.selectedColor;
        break;
      case 'sly_deal':
        opts.targetPlayerId = targeting.selectedPlayerId;
        opts.targetCardId = targeting.selectedCardId;
        break;
      case 'forced_deal':
        opts.targetPlayerId = targeting.selectedPlayerId;
        opts.targetCardId = targeting.selectedCardId;
        opts.offeredCardId = targeting.selectedMyCardId;
        break;
      case 'house':
      case 'hotel':
        opts.color = targeting.selectedColor;
        break;
      case 'rent':
        opts.color = targeting.selectedColor;
        if (targeting.selectedPlayerId) opts.targetPlayerId = targeting.selectedPlayerId;
        if (targeting.dtrCardIds && targeting.dtrCardIds.length > 0) opts.doubleTheRentCardIds = targeting.dtrCardIds;
        break;
    }

    socket.emit('game:play-card', { cardId: targeting.cardId, ...opts });
    setTargeting(null);
    setSelectedCardId(null);
  }

  function cancelTargeting() {
    setTargeting(null);
  }

  // ─── Chat ─────────────────────────────────────────────────────────

  function sendChat() {
    const text = chatInput.trim();
    if (!text) return;
    socket.emit('chat:message', { text });
    setChatInput('');
  }

  function sendReaction(emoji: string) {
    socket.emit('chat:reaction', { emoji });
    setReactionBarOpen(false);
  }

  // ─── Hand swap ───────────────────────────────────────────────────

  function handleHandCardClick(card: AnyCard, index: number) {
    if (swapMode !== null) {
      if (swapMode !== index) {
        reorderHand(swapMode, index);
      }
      setSwapMode(null);
      return;
    }
    handleCardClick(card);
  }

  // ─── Card click ────────────────────────────────────────────────────

  function handleCardClick(card: AnyCard) {
    if (targeting) { cancelTargeting(); return; }
    if (isMyTurn && gameState.turnPhase === 'discard') {
      socket.emit('game:discard', { cardIds: [card.id] });
      setSelectedCardId(null);
      return;
    }
    setSelectedCardId(card.id === selectedCardId ? null : card.id);
  }

  function playCardSimple(card: AnyCard, opts: Record<string, any> = {}) {
    socket.emit('game:play-card', { cardId: card.id, ...opts });
    setSelectedCardId(null);
    setTargeting(null);
  }

  // ─── My-area targeting handlers ────────────────────────────────────

  function handleMySetClick(color: PropertyColor) {
    if (!targeting) return;
    const step = targeting.steps[targeting.currentStep];
    if (step?.type === 'select_rent_color') advanceTargeting({ selectedColor: color });
  }

  function handleMyCardClick(cardId: string) {
    if (!targeting) return;
    const step = targeting.steps[targeting.currentStep];
    if (step?.type === 'select_my_card') advanceTargeting({ selectedMyCardId: cardId });
  }

  // ─── Drag and Drop ─────────────────────────────────────────────────

  function handleDragStart(event: DragStartEvent) {
    const card = event.active.data.current?.card as AnyCard | undefined;
    if (card) setDraggedCard(card);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggedCard(null);
    const { active, over } = event;
    if (!over || !isMyTurn || !gameState) return;
    const turnPhase = gameState.turnPhase;
    if (turnPhase !== 'action' && turnPhase !== 'discard') return;

    const card = active.data.current?.card as AnyCard | undefined;
    if (!card) return;
    const dropId = over.id as string;

    // Discard phase: only discard pile accepts
    if (turnPhase === 'discard') {
      if (dropId === 'drop-discard') {
        socket.emit('game:discard', { cardIds: [card.id] });
        setSelectedCardId(null);
      }
      return;
    }

    // Action phase
    if (dropId === 'drop-bank') {
      playCardSimple(card, { asMoney: true });
      return;
    }

    if (dropId === 'drop-property' || dropId === 'my-area') {
      if (card.type === 'money') {
        playCardSimple(card, { asMoney: true });
        return;
      }
      if (card.type === 'property') {
        playCardSimple(card);
        return;
      }
      if (card.type === 'property_wildcard') {
        const colors = card.colors === 'all'
          ? (['brown','blue','green','light_blue','orange','pink','railroad','red','yellow','utility'] as PropertyColor[])
          : [...card.colors];
        setSelectedCardId(card.id);
        setColorPicker({
          colors,
          label: 'Choisis la couleur pour ce joker',
          resolve: (color) => {
            playCardSimple(card, { color });
            setColorPicker(null);
          },
        });
        return;
      }
      if (card.type === 'action' && card.actionType === 'pass_go') {
        playCardSimple(card);
        return;
      }
      if (card.type === 'action' && card.actionType === 'its_my_birthday') {
        playCardSimple(card);
        return;
      }
      if (card.type === 'action' && (card.actionType === 'house' || card.actionType === 'hotel')) {
        setSelectedCardId(card.id);
        startTargeting(card);
        return;
      }
      if (card.type === 'action' || card.type === 'rent') {
        setSelectedCardId(card.id);
        startTargeting(card);
        return;
      }
      playCardSimple(card, { asMoney: true });
      return;
    }

    if (dropId.startsWith('opponent-')) {
      const opponentId = over.data.current?.playerId as string;
      if (!opponentId) return;

      if (card.type === 'action' && card.actionType === 'debt_collector') {
        playCardSimple(card, { targetPlayerId: opponentId });
        return;
      }
      if (card.type === 'action' && ['sly_deal', 'deal_breaker', 'forced_deal'].includes(card.actionType)) {
        setSelectedCardId(card.id);
        const ts = startTargeting(card);
        if (ts) setTargeting({ ...ts, selectedPlayerId: opponentId, currentStep: 1 });
        return;
      }
      if (card.type === 'rent' && card.colors === 'all') {
        setSelectedCardId(card.id);
        const ts = startTargeting(card);
        if (ts) setTargeting({ ...ts, selectedPlayerId: opponentId, currentStep: 0 });
        return;
      }
      playCardSimple(card, { asMoney: true });
      return;
    }

    if (dropId === 'drop-discard') {
      // In action phase, can't discard - just bank it
      playCardSimple(card, { asMoney: true });
    }
  }

  // ─── Render ────────────────────────────────────────────────────────

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
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

        <div className="board">
          {/* Opponents row */}
          <div className="board-opponents">
            {opponents.map(p => (
              <PlayerArea
                key={p.id}
                player={p}
                isMe={false}
                isActive={p.id === currentPlayer?.id}
                targeting={targeting}
                onClickPlayer={() => handleTargetPlayer(p.id)}
                onClickCard={handleTargetCard}
                onClickSet={handleTargetSet}
              />
            ))}
          </div>

          {/* Center: piles + notifications */}
          <div className="board-center">
            <div className="piles">
              <div className="pile draw-pile">
                <div className="pile-label">Pioche</div>
                <div className="pile-count">{gameState.drawPileCount}</div>
              </div>
              <DropZone id="drop-discard" className={`pile discard-pile ${isMyTurn && gameState.turnPhase === 'discard' ? 'discard-pile-active' : ''}`}>
                <div className="pile-label">Defausse</div>
                <div className="pile-count">{gameState.discardPile.length}</div>
                {gameState.discardPile.length > 0 && (
                  <div className="pile-top">{displayName(gameState.discardPile[gameState.discardPile.length - 1])}</div>
                )}
              </DropZone>
            </div>
            <div className="notif-log">
              {notifications.slice(-4).map((msg, i) => (
                <div key={i} className="notif">{msg}</div>
              ))}
            </div>
          </div>

          {/* My area */}
          {me && (
            <div className="board-me">
              <DropZone id="drop-property" className="my-zone my-properties-zone">
                <h3>Mes Proprietes ({me.propertySets.filter(s => s.isComplete).length}/3)</h3>
                <div className="pa-properties">
                  {me.propertySets.map((set, i) => (
                    <MyPropertySet
                      key={`${set.color}-${i}`}
                      set={set}
                      targeting={targeting}
                      isMyTurn={isMyTurn}
                      onClickSet={handleMySetClick}
                      onClickCard={handleMyCardClick}
                      mySets={me.propertySets}
                    />
                  ))}
                  {me.propertySets.length === 0 && <div className="pa-empty">Depose tes proprietes ici</div>}
                </div>
              </DropZone>

              <DropZone id="drop-bank" className="my-zone my-bank-zone">
                <h3>Banque ({me.bank.reduce((s, c) => s + c.value, 0)}M)</h3>
                <div className="pa-bank-cards">
                  {me.bank.map(c => (
                    <span key={c.id} className="pa-bank-chip" title={`${displayName(c)} (${c.value}M)`}>
                      {c.value}M
                    </span>
                  ))}
                  {me.bank.length === 0 && <span className="pa-empty-small">Depose de l'argent ici</span>}
                </div>
              </DropZone>
            </div>
          )}
        </div>

        {/* Targeting bar */}
        {targeting && (
          <TargetingOverlay
            targeting={targeting}
            opponents={opponents}
            onConfirm={confirmTargeting}
            onCancel={cancelTargeting}
          />
        )}

        {/* JSN chain */}
        {jsnChainForMe && gameState.pendingAction && (
          <JsnChainBar action={gameState.pendingAction} />
        )}

        {/* Pending action */}
        {!jsnChainForMe && pendingForMe && gameState.pendingAction && me && (
          <PendingActionBar action={gameState.pendingAction} myId={myId!} me={me} />
        )}

        {/* Selected card info */}
        {selectedCard && !targeting && (
          <div className="selected-card-info">
            <strong>{displayName(selectedCard)}</strong>
            <span className="card-desc">{selectedCard.description}</span>
            <span className="card-val">Valeur : {selectedCard.value}M</span>
          </div>
        )}

        {/* Discard banner */}
        {isMyTurn && gameState.turnPhase === 'discard' && (
          <div className="discard-banner">
            <span className="discard-banner-icon">&#128465;</span>
            <span>Defausse {hand.length - 7} carte{hand.length - 7 > 1 ? 's' : ''} — clique sur une carte pour la defausser</span>
            <span className="discard-banner-count">{hand.length}/7</span>
          </div>
        )}

        {/* Floating reactions */}
        <div className="floating-reactions">
          {floatingReactions.map(r => (
            <div key={r.id} className="floating-reaction" style={{ left: `${r.x}%` }}>
              <span className="floating-emoji">{r.emoji}</span>
              <span className="floating-name">{r.playerName}</span>
            </div>
          ))}
        </div>

        {/* Chat panel */}
        {chatOpen && (
          <div className="chat-panel">
            <div className="chat-header">
              <span>Chat</span>
              <button className="chat-close" onClick={() => setChatOpen(false)}>&times;</button>
            </div>
            <div className="chat-messages">
              {chatMessages.map(msg => (
                <div key={msg.id} className={`chat-msg ${msg.playerId === myId ? 'chat-msg-mine' : ''}`}>
                  <span className="chat-msg-name">{msg.playerName}</span>
                  <span className="chat-msg-text">{msg.text}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="chat-input-row">
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChat()}
                placeholder="Message..."
                maxLength={200}
              />
              <button className="chat-send" onClick={sendChat}>&#9654;</button>
            </div>
          </div>
        )}

        {/* Hand + actions */}
        <div className={`player-hand-area ${isMyTurn && gameState.turnPhase === 'discard' ? 'discard-mode' : ''}`}>
          {handVisible && (
            <>
              {hand.length > 1 && (
                <div className="hand-sort-bar">
                  <button className={`btn-sort ${swapMode !== null ? 'btn-sort-active' : ''}`} onClick={() => setSwapMode(swapMode !== null ? null : -1)} title="Cliquer deux cartes pour les echanger">
                    &#8644; Deplacer
                  </button>
                  <button className="btn-sort" onClick={() => sortHand('type')}>Par type</button>
                  <button className="btn-sort" onClick={() => sortHand('color')}>Par couleur</button>
                  <button className="btn-sort" onClick={() => sortHand('value')}>Par valeur</button>
                </div>
              )}
              <div className="hand">
                {hand.map((card, i) => (
                  <CardInHand
                    key={card.id}
                    card={card}
                    selected={swapMode === i || (swapMode === null && card.id === selectedCardId)}
                    onClick={() => {
                      if (swapMode !== null) {
                        if (swapMode === -1) {
                          setSwapMode(i);
                        } else if (swapMode !== i) {
                          reorderHand(swapMode, i);
                          setSwapMode(null);
                        } else {
                          setSwapMode(null);
                        }
                        return;
                      }
                      handleCardClick(card);
                    }}
                    isDragDisabled={!isMyTurn || (gameState.turnPhase !== 'action' && gameState.turnPhase !== 'discard')}
                    discardMode={isMyTurn && gameState.turnPhase === 'discard'}
                  />
                ))}
                {hand.length === 0 && <div className="empty-text">Pas de cartes en main</div>}
              </div>
            </>
          )}

          <div className="action-bar">
            <div className="action-bar-left">
              <button className="btn-toggle-hand" onClick={() => setHandVisible(v => !v)}>
                {handVisible ? 'Cacher la main' : `Voir la main (${hand.length})`}
              </button>
              <button className="btn-chat-toggle" onClick={() => setChatOpen(v => !v)} title="Chat">
                &#128172;
              </button>
              <button className="btn-reaction-toggle" onClick={() => setReactionBarOpen(v => !v)} title="Reactions">
                &#128293;
              </button>
            </div>

            {isMyTurn && gameState.turnPhase === 'draw' && (
              <button className="btn-action" onClick={() => socket.emit('game:draw')}>
                Piocher {hand.length === 0 ? '5' : '2'} cartes
              </button>
            )}

            {isMyTurn && gameState.turnPhase === 'action' && selectedCard && !targeting && (
              <QuickActions
                card={selectedCard}
                mySets={me?.propertySets || []}
                hand={hand}
                actionsRemaining={gameState.actionsRemaining}
                onPlay={(opts) => playCardSimple(selectedCard, opts)}
                onStartTargeting={() => startTargeting(selectedCard)}
              />
            )}

            {isMyTurn && gameState.turnPhase === 'action' && (
              <button className="btn-secondary" onClick={() => {
                if (hand.length > 7 && gameState.actionsRemaining > 0) {
                  setShowDiscardConfirm(true);
                } else {
                  socket.emit('game:end-turn');
                }
              }}>
                Fin du tour
              </button>
            )}
          </div>

          {/* Reaction picker */}
          {reactionBarOpen && (
            <div className="reaction-bar">
              {REACTION_EMOJIS.map(emoji => (
                <button key={emoji} className="reaction-btn" onClick={() => sendReaction(emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {/* Swap mode hint */}
          {swapMode !== null && (
            <div className="swap-hint">
              {swapMode === -1 ? 'Clique sur la carte a deplacer' : 'Clique sur la destination'}
              <button className="btn-sort" onClick={() => setSwapMode(null)}>Annuler</button>
            </div>
          )}
        </div>

        {/* Discard confirmation modal */}
        {showDiscardConfirm && (
          <div className="color-picker-overlay" onClick={() => setShowDiscardConfirm(false)}>
            <div className="discard-confirm" onClick={e => e.stopPropagation()}>
              <div className="discard-confirm-title">Tu as {hand.length} cartes en main !</div>
              <div className="discard-confirm-sub">
                Il te reste {gameState.actionsRemaining} action{gameState.actionsRemaining > 1 ? 's' : ''}.
                Tu peux jouer des cartes pour descendre a 7 sans defausser.
              </div>
              <div className="discard-confirm-detail">
                {hand.length - 7} carte{hand.length - 7 > 1 ? 's' : ''} a defausser si tu termines maintenant.
              </div>
              <div className="discard-confirm-actions">
                <button className="btn-action" onClick={() => setShowDiscardConfirm(false)}>
                  Jouer des cartes
                </button>
                <button className="btn-danger" onClick={() => {
                  setShowDiscardConfirm(false);
                  socket.emit('game:end-turn');
                }}>
                  Defausser quand meme
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Color picker modal */}
        {colorPicker && (
          <ColorPicker
            colors={colorPicker.colors}
            label={colorPicker.label}
            onPick={colorPicker.resolve}
            onCancel={() => setColorPicker(null)}
          />
        )}

        <DragOverlay>
          {draggedCard ? <CardGhost card={draggedCard} /> : null}
        </DragOverlay>
      </div>
    </DndContext>
  );
}

// ─── My Property Set (with rearrange) ──────────────────────────────────────

function MyPropertySet({ set, targeting, isMyTurn, onClickSet, onClickCard, mySets }: {
  set: PropertySet;
  targeting: TargetingState | null;
  isMyTurn: boolean;
  onClickSet: (color: PropertyColor) => void;
  onClickCard: (cardId: string) => void;
  mySets: PropertySet[];
}) {
  const isRentColorTarget = targeting?.steps[targeting.currentStep]?.type === 'select_rent_color';
  const isMyCardTarget = targeting?.steps[targeting.currentStep]?.type === 'select_my_card';

  const targetable =
    (isRentColorTarget && (
      targeting?.actionType === 'house' ? set.isComplete && !set.hasHouse && set.color !== 'railroad' && set.color !== 'utility' :
      targeting?.actionType === 'hotel' ? set.isComplete && set.hasHouse && !set.hasHotel && set.color !== 'railroad' && set.color !== 'utility' :
      targeting?.actionType === 'rent' ? true : false
    )) ||
    (isMyCardTarget && !set.isComplete && set.cards.length > 0) ||
    false;

  const selectableCardIds = isMyCardTarget
    ? new Set(
        mySets.filter(s => !s.isComplete)
          .flatMap(s => s.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').map(c => c.id))
      )
    : undefined;

  return (
    <div className="my-prop-set-wrap">
      <PropertySetCard
        set={set}
        targetable={targetable}
        onClickSet={onClickSet}
        onClickCard={onClickCard}
        selectableCardIds={selectableCardIds}
      />
      {isMyTurn && set.cards.filter(c => c.type === 'property_wildcard').map(wc => (
        <RearrangeButton key={wc.id} card={wc} currentColor={set.color} />
      ))}
    </div>
  );
}

// ─── Rearrange Button ──────────────────────────────────────────────────────

function RearrangeButton({ card, currentColor }: { card: AnyCard; currentColor: PropertyColor }) {
  const [open, setOpen] = useState(false);
  if (card.type !== 'property_wildcard') return null;

  const colors: PropertyColor[] = card.colors === 'all'
    ? (['brown','blue','green','light_blue','orange','pink','railroad','red','yellow','utility'] as PropertyColor[])
    : [...card.colors];
  const otherColors = colors.filter(c => c !== currentColor);
  if (otherColors.length === 0) return null;

  return (
    <span className="rearrange-wrap">
      <button className="btn-rearrange" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
        &#8644;
      </button>
      {open && (
        <div className="rearrange-menu">
          {otherColors.map(c => (
            <button key={c} className="btn-color" style={{ background: COLOR_HEX[c], fontSize: '0.7em', padding: '2px 6px' }}
              onClick={(e) => {
                e.stopPropagation();
                socket.emit('game:rearrange', { cardId: card.id, toColor: c });
                setOpen(false);
              }}>
              {COLOR_NAMES[c]}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// ─── Quick Actions (click-based, non-targeting) ────────────────────────────

function QuickActions({ card, mySets, hand, actionsRemaining, onPlay, onStartTargeting }: {
  card: AnyCard;
  mySets: PropertySet[];
  hand: AnyCard[];
  actionsRemaining: number;
  onPlay: (opts: Record<string, any>) => void;
  onStartTargeting: () => void;
}) {
  const canBank = card.type !== 'property' && card.type !== 'property_wildcard';

  return (
    <div className="card-actions">
      {canBank && (
        <button className="btn-bank" onClick={() => onPlay({ asMoney: true })}>
          Banquer ({card.value}M)
        </button>
      )}

      {card.type === 'property' && (
        <button className="btn-action" onClick={() => onPlay({})}>
          Poser {displayName(card)}
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

      {card.type === 'action' && card.actionType === 'its_my_birthday' && (
        <button className="btn-action" onClick={() => onPlay({})}>C'est mon anniversaire !</button>
      )}

      {card.type === 'action' && card.actionType === 'just_say_no' && (
        <span className="hint">Utilisable uniquement en reaction</span>
      )}

      {card.type === 'action' && card.actionType === 'double_the_rent' && (
        <span className="hint">S'active auto avec une carte Loyer</span>
      )}

      {card.type === 'action' && ['debt_collector', 'deal_breaker', 'sly_deal', 'forced_deal', 'house', 'hotel'].includes(card.actionType) && (
        <button className="btn-action" onClick={onStartTargeting}>
          {card.actionType === 'debt_collector' ? 'Choisir la cible' :
           card.actionType === 'deal_breaker' ? 'Choisir le set a voler' :
           card.actionType === 'sly_deal' ? 'Choisir la propriete' :
           card.actionType === 'forced_deal' ? 'Echanger' :
           card.actionType === 'house' ? 'Placer la maison' : 'Placer l\'hotel'}
        </button>
      )}

      {card.type === 'rent' && (
        <RentQuickAction card={card} mySets={mySets} hand={hand} actionsRemaining={actionsRemaining} onPlay={onPlay} onStartTargeting={onStartTargeting} />
      )}
    </div>
  );
}

// ─── Rent Quick Action (with DTR checkboxes) ──────────────────────────────

function RentQuickAction({ card, mySets, hand, actionsRemaining, onPlay, onStartTargeting }: {
  card: AnyCard & { colors: any }; mySets: PropertySet[];
  hand: AnyCard[]; actionsRemaining: number;
  onPlay: (opts: Record<string, any>) => void;
  onStartTargeting: () => void;
}) {
  const [selectedDtr, setSelectedDtr] = useState<string[]>([]);

  const dtrCards = hand.filter(c =>
    c.id !== card.id && c.type === 'action' && c.actionType === 'double_the_rent'
  );
  const maxDtr = Math.min(dtrCards.length, actionsRemaining - 1);

  return (
    <>
      <button className="btn-action" onClick={onStartTargeting}>
        Reclamer le loyer
      </button>
      {maxDtr > 0 && (
        <div className="dtr-options">
          {dtrCards.slice(0, maxDtr).map(c => (
            <label key={c.id} className="dtr-option">
              <input
                type="checkbox"
                checked={selectedDtr.includes(c.id)}
                onChange={(e) => {
                  if (e.target.checked) setSelectedDtr([...selectedDtr, c.id]);
                  else setSelectedDtr(selectedDtr.filter(id => id !== c.id));
                }}
              />
              Loyer Double ! (x2)
            </label>
          ))}
        </div>
      )}
    </>
  );
}

// ─── JSN Chain Bar ──────────────────────────────────────────────────────────

function JsnChainBar({ action }: { action: PendingAction }) {
  const hand = useStore.getState().hand;
  const hasJSN = hand.some(c => c.type === 'action' && c.actionType === 'just_say_no');
  const cancelled = action.jsnChain?.actionCancelled;

  return (
    <div className="pending-bar">
      <div className="pending-info">
        {cancelled
          ? 'Ton action a ete annulee par un Non merci ! Contre-attaquer ?'
          : 'Ton Non merci ! a ete contre. Contre-attaquer ?'}
      </div>
      <div className="pending-actions">
        {hasJSN && (
          <button className="btn-danger" onClick={() => socket.emit('game:respond', { accept: true })}>
            Non merci ! (contre)
          </button>
        )}
        <button className="btn-secondary" onClick={() => socket.emit('game:respond', { accept: false })}>
          Laisser faire
        </button>
      </div>
    </div>
  );
}

// ─── Pending Action Bar ─────────────────────────────────────────────────────

function PendingActionBar({ action, myId, me }: { action: PendingAction; myId: string; me: Player }) {
  const [selectedPayment, setSelectedPayment] = useState<string[]>([]);

  const needsPayment = action.type === 'rent' || action.type === 'debt_collector' || action.type === 'its_my_birthday';

  const payableCards: { id: string; name: string; value: number; source: string }[] = [];
  for (const card of me.bank) {
    payableCards.push({ id: card.id, name: `${displayName(card)} (banque)`, value: card.value, source: 'banque' });
  }
  for (const set of me.propertySets) {
    for (const card of set.cards) {
      if (card.type === 'property_wildcard' && card.colors === 'all') continue;
      payableCards.push({ id: card.id, name: `${displayName(card)} (${COLOR_NAMES[set.color]})`, value: card.value, source: set.color });
    }
  }

  const selectedTotal = payableCards
    .filter(c => selectedPayment.includes(c.id))
    .reduce((s, c) => s + c.value, 0);

  const totalPayable = payableCards.reduce((s, c) => s + c.value, 0);
  const allSelected = payableCards.length > 0 && selectedPayment.length === payableCards.length;
  const cannotAfford = totalPayable < (action.amount || 0);

  const handStore = useStore.getState().hand;
  const hasJSN = handStore.some(c => c.type === 'action' && c.actionType === 'just_say_no');

  const actionLabels: Record<string, string> = {
    rent: `Tu dois payer ${action.amount}M de loyer !`,
    debt_collector: `Tu dois payer ${action.amount}M de dette !`,
    its_my_birthday: `Paye ${action.amount}M pour son anniversaire !`,
    deal_breaker: `Il veut voler ton set ${action.targetSetColor ? COLOR_NAMES[action.targetSetColor] : ''} complet !`,
    sly_deal: 'Il veut voler une de tes proprietes !',
    forced_deal: 'Il veut echanger une propriete avec toi !',
  };

  const payDisabled = needsPayment
    && selectedTotal < (action.amount || 0)
    && !allSelected
    && payableCards.length > 0;

  return (
    <div className="pending-bar">
      <div className="pending-info">{actionLabels[action.type]}</div>

      {needsPayment && (
        <div className="payment-select">
          {cannotAfford && (
            <div className="payment-hint">
              Tu n'as pas assez ({totalPayable}M sur {action.amount}M). Selectionne tout ce que tu peux donner.
            </div>
          )}
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
            {cannotAfford && allSelected && <span className="underpay"> (tu donnes tout)</span>}
          </div>
          {cannotAfford && !allSelected && payableCards.length > 0 && (
            <button className="btn-select-all" onClick={() => setSelectedPayment(payableCards.map(c => c.id))}>
              Tout selectionner
            </button>
          )}
        </div>
      )}

      <div className="pending-actions">
        <button
          className="btn-action"
          disabled={payDisabled}
          onClick={() => socket.emit('game:respond', { accept: true, paymentCardIds: selectedPayment })}
        >
          {needsPayment
            ? (payableCards.length === 0
              ? 'Je n\'ai rien'
              : allSelected && cannotAfford
                ? `Tout donner (${selectedTotal}M)`
                : `Payer ${selectedTotal}M`)
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
