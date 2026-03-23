import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore.ts';
import { socket } from '../socket/index.ts';
import { audioManager } from './AudioManager.ts';
import { SOUND_NAMES, ACTION_TYPE_SOUND } from './soundMap.ts';
import type { GameState } from '@monopoly-deal/shared';

/**
 * Observes game state changes and socket events to trigger sounds.
 * Should be called once in App.tsx.
 */
export function useGameSounds() {
  const gameState = useStore(s => s.gameState);
  const hand = useStore(s => s.hand);
  const prev = useRef<{
    phase: string | null;
    currentPlayerIndex: number;
    handSize: number;
    turnPhase: string | null;
    pendingActionType: string | null;
    completeSets: number;
    winnerId: string | undefined;
    turnNumber: number;
  }>({
    phase: null,
    currentPlayerIndex: -1,
    handSize: 0,
    turnPhase: null,
    pendingActionType: null,
    completeSets: 0,
    winnerId: undefined,
    turnNumber: 0,
  });

  // Game state change sounds
  useEffect(() => {
    if (!gameState) return;

    const myId = socket.id;
    const p = prev.current;
    const me = gameState.players.find(pl => pl.id === myId);
    const myCompleteSets = me?.propertySets.filter(s => s.isComplete).length ?? 0;

    // Game start
    if (p.phase !== 'playing' && gameState.phase === 'playing') {
      audioManager.play(SOUND_NAMES.GAME_START);
    }

    // Your turn (new turn started and it's my turn)
    if (gameState.phase === 'playing' && gameState.currentPlayerIndex !== p.currentPlayerIndex) {
      const isMyTurn = gameState.players[gameState.currentPlayerIndex]?.id === myId;
      if (isMyTurn) {
        audioManager.play(SOUND_NAMES.YOUR_TURN);
      }
    }

    // Card draw: hand size increased during draw phase
    if (hand.length > p.handSize && gameState.turnPhase === 'draw') {
      audioManager.play(SOUND_NAMES.CARD_DRAW);
    }
    // Also detect draw when transitioning from draw to action phase (bulk draw)
    if (p.turnPhase === 'draw' && gameState.turnPhase === 'action' && hand.length > p.handSize) {
      audioManager.play(SOUND_NAMES.CARD_DRAW);
    }

    // Pending action sounds (special actions)
    const currentPendingType = gameState.pendingAction?.type ?? null;
    if (currentPendingType && currentPendingType !== p.pendingActionType) {
      const sound = ACTION_TYPE_SOUND[currentPendingType];
      if (sound) audioManager.play(sound);
    }

    // Just Say No chain
    if (gameState.pendingAction?.jsnChain) {
      const chain = gameState.pendingAction.jsnChain;
      if (chain.awaitingCounterFrom && p.pendingActionType === currentPendingType) {
        // JSN was just played - we detect this by chain existing when it wasn't before
        // This is approximate; the important case is already handled by notification sounds
      }
    }

    // Set complete
    if (myCompleteSets > p.completeSets && p.completeSets >= 0) {
      audioManager.play(SOUND_NAMES.SET_COMPLETE);
    }

    // Victory / Defeat
    if (gameState.phase === 'finished' && p.phase !== 'finished') {
      if (gameState.winnerId === myId) {
        audioManager.play(SOUND_NAMES.VICTORY);
      } else {
        audioManager.play(SOUND_NAMES.DEFEAT);
      }
    }

    // Update prev refs
    prev.current = {
      phase: gameState.phase,
      currentPlayerIndex: gameState.currentPlayerIndex,
      handSize: hand.length,
      turnPhase: gameState.turnPhase,
      pendingActionType: currentPendingType,
      completeSets: myCompleteSets,
      winnerId: gameState.winnerId,
      turnNumber: gameState.turnNumber,
    };
  }, [gameState, hand]);

  // Socket event sounds (chat, reactions, notifications)
  useEffect(() => {
    const onChat = () => audioManager.play(SOUND_NAMES.CHAT_MESSAGE);
    const onReaction = () => audioManager.play(SOUND_NAMES.EMOJI_REACTION);
    const onNotification = (msg: string) => {
      const myName = localStorage.getItem('monopoly-name') ?? '';
      const lower = msg.toLowerCase();

      // Payment sounds
      if (lower.includes('paye') || lower.includes('payment')) {
        if (msg.includes(myName) && lower.indexOf(myName.toLowerCase()) < lower.indexOf('paye')) {
          audioManager.play(SOUND_NAMES.PAYMENT_SENT);
        } else {
          audioManager.play(SOUND_NAMES.PAYMENT_RECEIVED);
        }
      }

      // Just Say No
      if (lower.includes('just say no') || lower.includes('non !')) {
        audioManager.play(SOUND_NAMES.JUST_SAY_NO);
      }

      // Card play sounds from notifications about other players
      if (lower.includes('joue') && !lower.includes(myName.toLowerCase())) {
        if (lower.includes('propriete') || lower.includes('property')) {
          audioManager.play(SOUND_NAMES.CARD_PLAY_PROPERTY);
        } else if (lower.includes('banque') || lower.includes('bank')) {
          audioManager.play(SOUND_NAMES.CARD_PLAY_MONEY);
        }
      }
    };

    socket.on('chat:message', onChat);
    socket.on('chat:reaction', onReaction);
    socket.on('game:notification', onNotification);

    return () => {
      socket.off('chat:message', onChat);
      socket.off('chat:reaction', onReaction);
      socket.off('game:notification', onNotification);
    };
  }, []);
}
