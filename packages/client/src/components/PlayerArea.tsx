import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { displayName, COLOR_HEX, COLOR_NAMES, SET_SIZE, type Player, type PropertyColor } from '@monopoly-deal/shared';
import { PropertySetCard } from './PropertySetCard.tsx';
import type { TargetingState } from './types.ts';

interface Props {
  player: Player;
  isMe: boolean;
  isActive: boolean;
  targeting: TargetingState | null;
  onClickPlayer?: () => void;
  onClickCard?: (cardId: string) => void;
  onClickSet?: (color: PropertyColor) => void;
}

export function PlayerArea({
  player, isMe, isActive, targeting,
  onClickPlayer, onClickCard, onClickSet,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const { setNodeRef, isOver } = useDroppable({
    id: isMe ? 'my-area' : `opponent-${player.id}`,
    data: { playerId: player.id, isMe },
  });

  const isPlayerTargetable = targeting && !isMe && targeting.steps[targeting.currentStep]?.type === 'select_player';
  const isPlayerHighlighted = targeting?.selectedPlayerId === player.id;

  const isSetTargetable = targeting && !isMe &&
    targeting.selectedPlayerId === player.id &&
    targeting.steps[targeting.currentStep]?.type === 'select_complete_set';

  const isCardTargetable = targeting && !isMe &&
    targeting.selectedPlayerId === player.id &&
    targeting.steps[targeting.currentStep]?.type === 'select_incomplete_card';

  const isMyCardTargetable = targeting && isMe &&
    targeting.steps[targeting.currentStep]?.type === 'select_my_card';

  const selectableCardIds = new Set<string>();
  if (isCardTargetable) {
    player.propertySets
      .filter(s => !s.isComplete)
      .forEach(s => s.cards
        .filter(c => c.type === 'property' || c.type === 'property_wildcard')
        .forEach(c => selectableCardIds.add(c.id)));
  }
  if (isMyCardTargetable) {
    player.propertySets
      .filter(s => !s.isComplete)
      .forEach(s => s.cards
        .filter(c => c.type === 'property' || c.type === 'property_wildcard')
        .forEach(c => selectableCardIds.add(c.id)));
  }

  const bankTotal = player.bank.reduce((s, c) => s + c.value, 0);
  const completeSets = player.propertySets.filter(s => s.isComplete).length;
  const totalSets = player.propertySets.length;

  const areaClasses = [
    'player-area-board',
    isMe ? 'player-area-me' : 'player-area-opponent',
    isActive ? 'player-area-active' : '',
    isPlayerTargetable ? 'player-area-targetable' : '',
    isPlayerHighlighted ? 'player-area-targeted' : '',
    isOver ? 'player-area-drop-over' : '',
    !player.connected ? 'player-area-disconnected' : '',
    collapsed && !isMe ? 'player-area-collapsed' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={setNodeRef}
      className={areaClasses}
      onClick={() => {
        if (isPlayerTargetable) onClickPlayer?.();
      }}
    >
      <div className="pa-header">
        <div className="pa-name-row">
          <strong className="pa-name">{player.name}</strong>
          {isActive && <span className="pa-turn-badge">Tour</span>}
          {!player.connected && <span className="pa-dc-badge">DC</span>}
        </div>
        <div className="pa-stats">
          {!isMe && <span className="pa-stat">{player.handCount} cartes</span>}
          <span className="pa-stat">{bankTotal}M</span>
          <span className="pa-stat">{completeSets}/3</span>
          {!isMe && (
            <button
              className="pa-collapse-btn"
              onClick={(e) => { e.stopPropagation(); setCollapsed(v => !v); }}
              title={collapsed ? 'Developper' : 'Reduire'}
            >
              {collapsed ? '+' : '−'}
            </button>
          )}
        </div>
      </div>

      {collapsed && !isMe ? (
        <div className="pa-summary">
          {totalSets > 0
            ? player.propertySets.map((s, i) => {
                const propCount = s.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length;
                return (
                  <span key={`${s.color}-${i}`} className="pa-summary-pill" style={{ background: COLOR_HEX[s.color] }}>
                    {propCount}/{SET_SIZE[s.color]}
                  </span>
                );
              })
            : <span className="pa-empty-small">Aucune propriete</span>
          }
        </div>
      ) : (
        <div className="pa-board-content">
          <div className="pa-properties">
            {player.propertySets.map((set, i) => (
              <PropertySetCard
                key={`${set.color}-${i}`}
                set={set}
                compact={!isMe}
                targetable={
                  (isSetTargetable && set.isComplete) ||
                  (isCardTargetable && !set.isComplete && set.cards.length > 0) ||
                  (isMyCardTargetable && !set.isComplete && set.cards.length > 0) ||
                  false
                }
                highlighted={targeting?.selectedColor === set.color && (isSetTargetable || false)}
                dimmed={
                  (isSetTargetable && !set.isComplete) ||
                  (isCardTargetable && set.isComplete) ||
                  false
                }
                onClickSet={onClickSet}
                onClickCard={onClickCard}
                selectableCardIds={selectableCardIds}
              />
            ))}
            {player.propertySets.length === 0 && (
              <div className="pa-empty">{isMe ? 'Depose tes proprietes ici' : 'Aucune propriete'}</div>
            )}
          </div>

          <div className="pa-bank">
            <div className="pa-bank-label">Banque</div>
            <div className="pa-bank-cards">
              {player.bank.length > 0 ? (
                player.bank.map((c, i) => (
                  <span
                    key={c.id}
                    className="pa-bank-chip"
                    style={{ '--chip-idx': i } as React.CSSProperties}
                    title={`${displayName(c)} (${c.value}M)`}
                  >
                    {c.value}M
                  </span>
                ))
              ) : (
                <span className="pa-empty-small">{isMe ? 'Depose ici' : 'Vide'}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
