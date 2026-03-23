import { useCallback, useSyncExternalStore } from 'react';
import { audioManager } from './AudioManager.ts';
import type { SoundName } from './soundMap.ts';

// Simple external store to make React re-render on volume/mute changes
let listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

// Cache snapshot so useSyncExternalStore gets a stable reference
let cachedSnapshot = { volume: audioManager.volume, muted: audioManager.muted };
function notify() {
  cachedSnapshot = { volume: audioManager.volume, muted: audioManager.muted };
  listeners.forEach(cb => cb());
}
function getSnapshot() {
  return cachedSnapshot;
}

export function useAudio() {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  const play = useCallback((name: SoundName) => {
    audioManager.play(name);
  }, []);

  const setVolume = useCallback((v: number) => {
    audioManager.volume = v;
    notify();
  }, []);

  const toggleMute = useCallback(() => {
    audioManager.toggleMute();
    notify();
  }, []);

  return {
    play,
    volume: state.volume,
    muted: state.muted,
    setVolume,
    toggleMute,
  };
}
