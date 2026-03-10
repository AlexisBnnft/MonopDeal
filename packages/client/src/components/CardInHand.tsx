import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  COLOR_HEX, COLOR_NAMES, SET_SIZE, RENT_VALUES, displayName,
  type AnyCard, type PropertyColor,
} from '@monopoly-deal/shared';

interface Props {
  card: AnyCard;
  selected: boolean;
  onClick: () => void;
  isDragDisabled?: boolean;
}

export function CardInHand({ card, selected, onClick, isDragDisabled }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `hand-${card.id}`,
    data: { card },
    disabled: isDragDisabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <GameCard card={card} selected={selected} onClick={onClick} isDragging={isDragging} />
    </div>
  );
}

export function CardGhost({ card }: { card: AnyCard }) {
  return (
    <div style={{ transform: 'rotate(3deg) scale(1.05)', filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.5))' }}>
      <GameCard card={card} selected={false} onClick={() => {}} />
    </div>
  );
}

// ─── Card dispatcher ────────────────────────────────────────────────────────

function GameCard({ card, selected, onClick, isDragging }: {
  card: AnyCard; selected: boolean; onClick: () => void; isDragging?: boolean;
}) {
  if (card.type === 'property') return <PropertyCardView card={card} selected={selected} onClick={onClick} isDragging={isDragging} />;
  if (card.type === 'property_wildcard') return <WildcardCardView card={card} selected={selected} onClick={onClick} isDragging={isDragging} />;
  if (card.type === 'money') return <MoneyCardView card={card} selected={selected} onClick={onClick} isDragging={isDragging} />;
  if (card.type === 'action') return <ActionCardView card={card} selected={selected} onClick={onClick} isDragging={isDragging} />;
  if (card.type === 'rent') return <RentCardView card={card} selected={selected} onClick={onClick} isDragging={isDragging} />;
  return null;
}

// ─── Property Card ──────────────────────────────────────────────────────────

function PropertyCardView({ card, selected, onClick, isDragging }: {
  card: AnyCard & { color: PropertyColor }; selected: boolean; onClick: () => void; isDragging?: boolean;
}) {
  const rents = RENT_VALUES[card.color];
  const setSize = SET_SIZE[card.color];

  return (
    <div className={`game-card ${selected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`} onClick={onClick}>
      <div className="gc-color-band" style={{ background: COLOR_HEX[card.color] }}>
        <span className="gc-color-name">{COLOR_NAMES[card.color]}</span>
        <span className="gc-set-size">{setSize} pour le set</span>
      </div>
      <div className="gc-body">
        <div className="gc-title">{displayName(card)}</div>
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

// ─── Wildcard Card ──────────────────────────────────────────────────────────

function WildcardCardView({ card, selected, onClick, isDragging }: {
  card: AnyCard & { colors: [PropertyColor, PropertyColor] | 'all'; currentColor: PropertyColor }; selected: boolean; onClick: () => void; isDragging?: boolean;
}) {
  const isUniversal = card.colors === 'all';

  return (
    <div className={`game-card wildcard ${selected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`} onClick={onClick}>
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
        <div className="gc-title">{displayName(card)}</div>
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

// ─── Money Card ─────────────────────────────────────────────────────────────

function MoneyCardView({ card, selected, onClick, isDragging }: {
  card: AnyCard; selected: boolean; onClick: () => void; isDragging?: boolean;
}) {
  return (
    <div className={`game-card money-card ${selected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`} onClick={onClick}>
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

// ─── Action Card ────────────────────────────────────────────────────────────

const ACTION_COLORS: Record<string, string> = {
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

function ActionCardView({ card, selected, onClick, isDragging }: {
  card: AnyCard & { actionType: string }; selected: boolean; onClick: () => void; isDragging?: boolean;
}) {
  const bg = ACTION_COLORS[card.actionType] || '#f39c12';

  return (
    <div className={`game-card action-card ${selected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`} onClick={onClick}>
      <div className="gc-color-band" style={{ background: bg }}>
        <span className="gc-color-name">ACTION</span>
      </div>
      <div className="gc-body">
        <div className="gc-title gc-action-title">{displayName(card)}</div>
        <div className="gc-desc">{card.description}</div>
      </div>
      <div className="gc-footer">
        <span className="gc-value">{card.value}M</span>
      </div>
    </div>
  );
}

// ─── Rent Card ──────────────────────────────────────────────────────────────

function RentCardView({ card, selected, onClick, isDragging }: {
  card: AnyCard & { colors: [PropertyColor, PropertyColor] | 'all' }; selected: boolean; onClick: () => void; isDragging?: boolean;
}) {
  const isWild = card.colors === 'all';

  return (
    <div className={`game-card rent-card ${selected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`} onClick={onClick}>
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
        <div className="gc-title">{displayName(card)}</div>
        <div className="gc-desc">{card.description}</div>
        {!isWild && (
          <div className="gc-rent-preview">
            {card.colors.map((color: PropertyColor) => (
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
