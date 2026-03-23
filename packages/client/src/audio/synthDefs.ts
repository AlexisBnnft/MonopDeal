import type { SoundName } from './soundMap.ts';

interface SynthNote {
  freq?: number;
  freqEnd?: number;
  start?: number;
  dur?: number;
  vol?: number;
  wave?: OscillatorType;
}

interface SynthDef {
  type: OscillatorType | 'noise';
  duration: number;
  volume: number;
  notes: SynthNote[];
  filterFreq?: number;
  filterQ?: number;
}

// Synthesized sound definitions for each game sound.
// These provide immediate audio feedback without requiring external files.
export const SYNTH_DEFS: Record<SoundName, SynthDef> = {
  // ── Card Actions ──────────────────────────────────────────

  'card-draw': {
    type: 'sine',
    duration: 0.2,
    volume: 0.5,
    notes: [
      { freq: 600, freqEnd: 900, dur: 0.15, vol: 0.4 },
      { freq: 900, start: 0.05, dur: 0.15, vol: 0.3, wave: 'triangle' },
    ],
  },

  'card-play-property': {
    type: 'sine',
    duration: 0.2,
    volume: 0.5,
    notes: [
      { freq: 523, dur: 0.1, vol: 0.5 },
      { freq: 659, start: 0.08, dur: 0.12, vol: 0.4 },
    ],
  },

  'card-play-money': {
    type: 'sine',
    duration: 0.18,
    volume: 0.5,
    notes: [
      { freq: 1200, freqEnd: 800, dur: 0.08, vol: 0.3, wave: 'triangle' },
      { freq: 1400, freqEnd: 1000, start: 0.04, dur: 0.1, vol: 0.25, wave: 'triangle' },
    ],
  },

  'card-play-action': {
    type: 'square',
    duration: 0.25,
    volume: 0.4,
    notes: [
      { freq: 440, dur: 0.08, vol: 0.35, wave: 'square' },
      { freq: 554, start: 0.08, dur: 0.08, vol: 0.35, wave: 'square' },
      { freq: 659, start: 0.16, dur: 0.09, vol: 0.3, wave: 'square' },
    ],
  },

  'card-discard': {
    type: 'noise',
    duration: 0.15,
    volume: 0.3,
    notes: [],
    filterFreq: 3000,
    filterQ: 0.5,
  },

  // ── Special Actions ───────────────────────────────────────

  'action-sly-deal': {
    type: 'sine',
    duration: 0.4,
    volume: 0.6,
    notes: [
      { freq: 300, freqEnd: 500, dur: 0.15, vol: 0.5, wave: 'sawtooth' },
      { freq: 500, freqEnd: 300, start: 0.15, dur: 0.2, vol: 0.4, wave: 'sawtooth' },
    ],
  },

  'action-forced-deal': {
    type: 'sine',
    duration: 0.4,
    volume: 0.6,
    notes: [
      { freq: 350, dur: 0.1, vol: 0.5, wave: 'square' },
      { freq: 500, start: 0.12, dur: 0.1, vol: 0.5, wave: 'square' },
      { freq: 350, start: 0.24, dur: 0.15, vol: 0.4, wave: 'square' },
    ],
  },

  'action-deal-breaker': {
    type: 'sine',
    duration: 0.6,
    volume: 0.7,
    notes: [
      { freq: 200, dur: 0.15, vol: 0.6, wave: 'sawtooth' },
      { freq: 250, start: 0.1, dur: 0.15, vol: 0.6, wave: 'sawtooth' },
      { freq: 300, start: 0.2, dur: 0.15, vol: 0.5, wave: 'sawtooth' },
      { freq: 400, start: 0.3, dur: 0.3, vol: 0.7, wave: 'sawtooth' },
    ],
  },

  'action-debt-collector': {
    type: 'sine',
    duration: 0.35,
    volume: 0.6,
    notes: [
      { freq: 250, freqEnd: 400, dur: 0.15, vol: 0.5, wave: 'square' },
      { freq: 400, start: 0.15, dur: 0.2, vol: 0.5, wave: 'triangle' },
    ],
  },

  'action-birthday': {
    type: 'sine',
    duration: 0.5,
    volume: 0.6,
    notes: [
      { freq: 523, dur: 0.12, vol: 0.5 },
      { freq: 523, start: 0.12, dur: 0.12, vol: 0.4 },
      { freq: 587, start: 0.24, dur: 0.12, vol: 0.5 },
      { freq: 523, start: 0.36, dur: 0.14, vol: 0.4 },
    ],
  },

  'action-rent': {
    type: 'sine',
    duration: 0.35,
    volume: 0.6,
    notes: [
      { freq: 880, dur: 0.1, vol: 0.5, wave: 'triangle' },
      { freq: 660, start: 0.1, dur: 0.1, vol: 0.5, wave: 'triangle' },
      { freq: 880, start: 0.2, dur: 0.15, vol: 0.4, wave: 'triangle' },
    ],
  },

  'action-pass-go': {
    type: 'sine',
    duration: 0.25,
    volume: 0.4,
    notes: [
      { freq: 659, dur: 0.1, vol: 0.4 },
      { freq: 784, start: 0.1, dur: 0.15, vol: 0.35 },
    ],
  },

  // ── Defensive / Payment ───────────────────────────────────

  'just-say-no': {
    type: 'sine',
    duration: 0.5,
    volume: 0.7,
    notes: [
      { freq: 600, dur: 0.12, vol: 0.6, wave: 'square' },
      { freq: 450, start: 0.12, dur: 0.12, vol: 0.6, wave: 'square' },
      { freq: 300, start: 0.24, dur: 0.25, vol: 0.5, wave: 'square' },
    ],
  },

  'payment-sent': {
    type: 'sine',
    duration: 0.25,
    volume: 0.4,
    notes: [
      { freq: 500, freqEnd: 350, dur: 0.2, vol: 0.4, wave: 'triangle' },
    ],
  },

  'payment-received': {
    type: 'sine',
    duration: 0.25,
    volume: 0.5,
    notes: [
      { freq: 800, dur: 0.08, vol: 0.4, wave: 'triangle' },
      { freq: 1000, start: 0.08, dur: 0.1, vol: 0.35, wave: 'triangle' },
      { freq: 1200, start: 0.16, dur: 0.09, vol: 0.3, wave: 'triangle' },
    ],
  },

  // ── Game Flow ─────────────────────────────────────────────

  'game-start': {
    type: 'sine',
    duration: 0.8,
    volume: 0.7,
    notes: [
      { freq: 392, dur: 0.15, vol: 0.6 },
      { freq: 494, start: 0.15, dur: 0.15, vol: 0.6 },
      { freq: 587, start: 0.3, dur: 0.15, vol: 0.6 },
      { freq: 784, start: 0.45, dur: 0.35, vol: 0.7 },
    ],
  },

  'your-turn': {
    type: 'sine',
    duration: 0.4,
    volume: 0.6,
    notes: [
      { freq: 660, dur: 0.12, vol: 0.5, wave: 'triangle' },
      { freq: 880, start: 0.12, dur: 0.2, vol: 0.5, wave: 'triangle' },
    ],
  },

  'turn-end': {
    type: 'sine',
    duration: 0.15,
    volume: 0.3,
    notes: [
      { freq: 500, freqEnd: 400, dur: 0.12, vol: 0.3 },
    ],
  },

  'set-complete': {
    type: 'sine',
    duration: 0.8,
    volume: 0.7,
    notes: [
      { freq: 523, dur: 0.15, vol: 0.6 },
      { freq: 659, start: 0.12, dur: 0.15, vol: 0.6 },
      { freq: 784, start: 0.24, dur: 0.15, vol: 0.6 },
      { freq: 1047, start: 0.36, dur: 0.4, vol: 0.7 },
    ],
  },

  'house-added': {
    type: 'sine',
    duration: 0.3,
    volume: 0.5,
    notes: [
      { freq: 440, dur: 0.1, vol: 0.4, wave: 'triangle' },
      { freq: 554, start: 0.1, dur: 0.1, vol: 0.4, wave: 'triangle' },
      { freq: 659, start: 0.2, dur: 0.1, vol: 0.4, wave: 'triangle' },
    ],
  },

  'hotel-added': {
    type: 'sine',
    duration: 0.4,
    volume: 0.6,
    notes: [
      { freq: 440, dur: 0.1, vol: 0.5, wave: 'triangle' },
      { freq: 554, start: 0.08, dur: 0.1, vol: 0.5, wave: 'triangle' },
      { freq: 659, start: 0.16, dur: 0.1, vol: 0.5, wave: 'triangle' },
      { freq: 880, start: 0.24, dur: 0.16, vol: 0.5, wave: 'triangle' },
    ],
  },

  'victory': {
    type: 'sine',
    duration: 1.5,
    volume: 0.8,
    notes: [
      { freq: 523, dur: 0.2, vol: 0.7 },
      { freq: 659, start: 0.15, dur: 0.2, vol: 0.7 },
      { freq: 784, start: 0.3, dur: 0.2, vol: 0.7 },
      { freq: 1047, start: 0.45, dur: 0.3, vol: 0.8 },
      { freq: 784, start: 0.7, dur: 0.15, vol: 0.6 },
      { freq: 1047, start: 0.85, dur: 0.15, vol: 0.7 },
      { freq: 1319, start: 1.0, dur: 0.5, vol: 0.8 },
    ],
  },

  'defeat': {
    type: 'sine',
    duration: 1.2,
    volume: 0.6,
    notes: [
      { freq: 400, dur: 0.3, vol: 0.5, wave: 'triangle' },
      { freq: 350, start: 0.3, dur: 0.3, vol: 0.4, wave: 'triangle' },
      { freq: 300, start: 0.6, dur: 0.3, vol: 0.35, wave: 'triangle' },
      { freq: 250, start: 0.9, dur: 0.3, vol: 0.3, wave: 'triangle' },
    ],
  },

  // ── UI / Social ───────────────────────────────────────────

  'chat-message': {
    type: 'sine',
    duration: 0.12,
    volume: 0.3,
    notes: [
      { freq: 1200, dur: 0.06, vol: 0.25 },
      { freq: 1500, start: 0.05, dur: 0.07, vol: 0.2 },
    ],
  },

  'emoji-reaction': {
    type: 'sine',
    duration: 0.15,
    volume: 0.3,
    notes: [
      { freq: 800, freqEnd: 1200, dur: 0.12, vol: 0.3, wave: 'triangle' },
    ],
  },

  'card-pickup': {
    type: 'sine',
    duration: 0.08,
    volume: 0.3,
    notes: [
      { freq: 800, freqEnd: 1000, dur: 0.06, vol: 0.25, wave: 'triangle' },
    ],
  },

  'card-drop': {
    type: 'sine',
    duration: 0.1,
    volume: 0.3,
    notes: [
      { freq: 600, freqEnd: 400, dur: 0.08, vol: 0.25, wave: 'triangle' },
    ],
  },
};
