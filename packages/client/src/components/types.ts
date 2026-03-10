import type { PropertyColor } from '@monopoly-deal/shared';

export type TargetingType =
  | 'select_player'
  | 'select_complete_set'
  | 'select_incomplete_card'
  | 'select_my_card'
  | 'select_rent_color';

export interface TargetingStep {
  type: TargetingType;
  label: string;
}

export interface TargetingState {
  cardId: string;
  actionType: string;
  steps: TargetingStep[];
  currentStep: number;
  selectedPlayerId?: string;
  selectedCardId?: string;
  selectedColor?: PropertyColor;
  selectedMyCardId?: string;
  dtrCardIds?: string[];
}

export interface DropResult {
  zone: 'bank' | 'property' | 'opponent' | 'discard';
  opponentId?: string;
  color?: PropertyColor;
}
