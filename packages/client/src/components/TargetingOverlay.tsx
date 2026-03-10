import { COLOR_HEX, COLOR_NAMES, type Player, type PropertyColor } from '@monopoly-deal/shared';
import type { TargetingState } from './types.ts';

interface TargetingProps {
  targeting: TargetingState;
  opponents: Player[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function TargetingOverlay({ targeting, opponents, onConfirm, onCancel }: TargetingProps) {
  const step = targeting.steps[targeting.currentStep];
  const done = targeting.currentStep >= targeting.steps.length;

  return (
    <div className="targeting-bar">
      <div className="targeting-info">
        {!done && step && (
          <span className="targeting-step-label">{step.label}</span>
        )}
        {done && <span className="targeting-step-label">Pret a jouer !</span>}

        {targeting.selectedPlayerId && (
          <span className="targeting-chip">
            Joueur: {opponents.find(p => p.id === targeting.selectedPlayerId)?.name ?? '?'}
          </span>
        )}
        {targeting.selectedColor && (
          <span className="targeting-chip" style={{ borderColor: COLOR_HEX[targeting.selectedColor] }}>
            Couleur: {COLOR_NAMES[targeting.selectedColor]}
          </span>
        )}
      </div>
      <div className="targeting-actions">
        {done && (
          <button className="btn-action" onClick={onConfirm}>Confirmer</button>
        )}
        <button className="btn-secondary" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}

interface ColorPickerProps {
  colors: PropertyColor[];
  label: string;
  onPick: (color: PropertyColor) => void;
  onCancel: () => void;
}

export function ColorPicker({ colors, label, onPick, onCancel }: ColorPickerProps) {
  return (
    <div className="color-picker-overlay" onClick={onCancel}>
      <div className="color-picker" onClick={e => e.stopPropagation()}>
        <div className="color-picker-label">{label}</div>
        <div className="color-picker-grid">
          {colors.map(c => (
            <button
              key={c}
              className="color-picker-btn"
              style={{ background: COLOR_HEX[c] }}
              onClick={() => onPick(c)}
            >
              {COLOR_NAMES[c]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
