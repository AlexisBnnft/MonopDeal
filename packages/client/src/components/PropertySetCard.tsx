import { motion, AnimatePresence } from 'framer-motion';
import {
  COLOR_HEX, COLOR_NAMES, SET_SIZE, RENT_VALUES, displayName,
  type PropertySet, type PropertyColor,
} from '@monopoly-deal/shared';

interface Props {
  set: PropertySet;
  compact?: boolean;
  targetable?: boolean;
  highlighted?: boolean;
  dimmed?: boolean;
  onClickCard?: (cardId: string) => void;
  onClickSet?: (color: PropertyColor) => void;
  selectableCardIds?: Set<string>;
}

export function PropertySetCard({
  set, compact, targetable, highlighted, dimmed,
  onClickCard, onClickSet, selectableCardIds,
}: Props) {
  const needed = SET_SIZE[set.color];
  const propCount = set.cards.filter(c => c.type === 'property' || c.type === 'property_wildcard').length;

  const rentIdx = Math.min(propCount, RENT_VALUES[set.color].length) - 1;
  let currentRent = rentIdx >= 0 ? RENT_VALUES[set.color][rentIdx] : 0;
  if (set.hasHouse) currentRent += 3;
  if (set.hasHotel) currentRent += 4;

  const hasOrphanedHouse = !set.hasHouse && set.cards.some(c => c.type === 'action' && c.actionType === 'house');
  const hasOrphanedHotel = !set.hasHotel && set.cards.some(c => c.type === 'action' && c.actionType === 'hotel');

  const classes = [
    'psc',
    set.isComplete ? 'psc-complete' : '',
    compact ? 'psc-compact' : '',
    targetable ? 'psc-targetable' : '',
    highlighted ? 'psc-highlighted' : '',
    dimmed ? 'psc-dimmed' : '',
  ].filter(Boolean).join(' ');

  return (
    <motion.div
      className={classes}
      style={{ '--set-color': COLOR_HEX[set.color] } as React.CSSProperties}
      onClick={() => onClickSet?.(set.color)}
      layout
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
    >
      <div className="psc-header">
        <span className="psc-title">{COLOR_NAMES[set.color]}</span>
        <span className="psc-count">{propCount}/{needed}</span>
        {!compact && <span className="psc-rent">{currentRent}M</span>}
      </div>
      <div className="psc-stack">
        <AnimatePresence>
          {set.cards
            .filter(c => c.type === 'property' || c.type === 'property_wildcard')
            .map((c, i) => {
              const isSelectable = selectableCardIds?.has(c.id);
              return (
                <motion.div
                  key={c.id}
                  layoutId={c.id}
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 20, opacity: 0, transition: { duration: 0.2 } }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30, delay: i * 0.03 }}
                  className={`psc-card ${isSelectable ? 'psc-card-selectable' : ''}`}
                  style={{ '--stack-idx': i } as React.CSSProperties}
                  onClick={(e) => {
                    if (isSelectable && onClickCard) {
                      e.stopPropagation();
                      onClickCard(c.id);
                    }
                  }}
                  title={c.description}
                >
                  <span className="psc-card-name">{compact ? displayName(c).slice(0, 14) : displayName(c)}</span>
                  {c.type === 'property_wildcard' && <span className="psc-wild">W</span>}
                </motion.div>
              );
            })}
        </AnimatePresence>
        {set.hasHouse && <div className="psc-bonus psc-house">Maison</div>}
        {set.hasHotel && <div className="psc-bonus psc-hotel">Hotel</div>}
        {hasOrphanedHouse && <div className="psc-bonus psc-orphan">Maison (orph.)</div>}
        {hasOrphanedHotel && <div className="psc-bonus psc-orphan">Hotel (orph.)</div>}
      </div>
      <AnimatePresence>
        {set.isComplete && (
          <motion.div
            className="psc-complete-tag"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          >
            COMPLET
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
