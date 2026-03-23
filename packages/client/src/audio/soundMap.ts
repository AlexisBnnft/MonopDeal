// Sound event names mapped to sprite regions [start_ms, duration_ms]
// These will be updated once we have the actual sprite file.
// For now, we use individual files as fallback.

export const SOUND_NAMES = {
  // Card actions
  CARD_DRAW: 'card-draw',
  CARD_PLAY_PROPERTY: 'card-play-property',
  CARD_PLAY_MONEY: 'card-play-money',
  CARD_PLAY_ACTION: 'card-play-action',
  CARD_DISCARD: 'card-discard',

  // Special actions
  ACTION_SLY_DEAL: 'action-sly-deal',
  ACTION_FORCED_DEAL: 'action-forced-deal',
  ACTION_DEAL_BREAKER: 'action-deal-breaker',
  ACTION_DEBT_COLLECTOR: 'action-debt-collector',
  ACTION_BIRTHDAY: 'action-birthday',
  ACTION_RENT: 'action-rent',
  ACTION_PASS_GO: 'action-pass-go',

  // Defensive / Payment
  JUST_SAY_NO: 'just-say-no',
  PAYMENT_SENT: 'payment-sent',
  PAYMENT_RECEIVED: 'payment-received',

  // Game flow
  GAME_START: 'game-start',
  YOUR_TURN: 'your-turn',
  TURN_END: 'turn-end',
  SET_COMPLETE: 'set-complete',
  HOUSE_ADDED: 'house-added',
  HOTEL_ADDED: 'hotel-added',
  VICTORY: 'victory',
  DEFEAT: 'defeat',

  // UI / Social
  CHAT_MESSAGE: 'chat-message',
  EMOJI_REACTION: 'emoji-reaction',
  CARD_PICKUP: 'card-pickup',
  CARD_DROP: 'card-drop',
} as const;

export type SoundName = (typeof SOUND_NAMES)[keyof typeof SOUND_NAMES];

// Map pending action types to sound names
export const ACTION_TYPE_SOUND: Record<string, SoundName> = {
  sly_deal: SOUND_NAMES.ACTION_SLY_DEAL,
  forced_deal: SOUND_NAMES.ACTION_FORCED_DEAL,
  deal_breaker: SOUND_NAMES.ACTION_DEAL_BREAKER,
  debt_collector: SOUND_NAMES.ACTION_DEBT_COLLECTOR,
  its_my_birthday: SOUND_NAMES.ACTION_BIRTHDAY,
  rent: SOUND_NAMES.ACTION_RENT,
  pass_go: SOUND_NAMES.ACTION_PASS_GO,
  house: SOUND_NAMES.HOUSE_ADDED,
  hotel: SOUND_NAMES.HOTEL_ADDED,
};
