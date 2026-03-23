import { Howl } from 'howler';
import type { SoundName } from './soundMap.ts';
import { SYNTH_DEFS } from './synthDefs.ts';

// Per-sound volume multipliers (relative to master volume)
const VOLUME_MAP: Partial<Record<SoundName, number>> = {
  'card-pickup': 0.4,
  'card-drop': 0.4,
  'card-draw': 0.5,
  'card-discard': 0.4,
  'card-play-property': 0.6,
  'card-play-money': 0.6,
  'card-play-action': 0.7,
  'chat-message': 0.3,
  'emoji-reaction': 0.4,
  'turn-end': 0.4,
  'your-turn': 0.7,
  'game-start': 0.8,
  'set-complete': 0.8,
  'victory': 0.9,
  'defeat': 0.7,
  'just-say-no': 0.8,
  'action-deal-breaker': 0.8,
  'action-sly-deal': 0.7,
  'action-forced-deal': 0.7,
  'action-debt-collector': 0.7,
  'action-birthday': 0.7,
  'action-rent': 0.7,
  'action-pass-go': 0.5,
  'payment-sent': 0.5,
  'payment-received': 0.5,
  'house-added': 0.6,
  'hotel-added': 0.7,
};

// Sounds that get slight pitch variation to avoid repetitive feel
const PITCH_VARY: Set<SoundName> = new Set([
  'card-draw', 'card-play-property', 'card-play-money', 'card-play-action',
  'card-discard', 'card-pickup', 'card-drop', 'chat-message',
]);

const ALL_SOUNDS: SoundName[] = [
  'card-draw', 'card-play-property', 'card-play-money', 'card-play-action', 'card-discard',
  'action-sly-deal', 'action-forced-deal', 'action-deal-breaker', 'action-debt-collector',
  'action-birthday', 'action-rent', 'action-pass-go',
  'just-say-no', 'payment-sent', 'payment-received',
  'game-start', 'your-turn', 'turn-end', 'set-complete',
  'house-added', 'hotel-added', 'victory', 'defeat',
  'chat-message', 'emoji-reaction', 'card-pickup', 'card-drop',
];

class AudioManager {
  private _sounds = new Map<string, Howl>();
  private _volume: number;
  private _muted: boolean;
  private _unlocked = false;
  private _ctx: AudioContext | null = null;
  private _useFiles = true; // Try files first, fall back to synth

  constructor() {
    this._volume = parseFloat(localStorage.getItem('monopoly-audio-volume') ?? '0.7');
    this._muted = localStorage.getItem('monopoly-audio-muted') === 'true';
  }

  /** Call on first user interaction to unlock audio context */
  init() {
    if (this._unlocked) return;
    this._unlocked = true;
    this._ctx = new AudioContext();
    this._preloadFiles();
  }

  private _preloadFiles() {
    for (const name of ALL_SOUNDS) {
      const howl = new Howl({
        src: [`/audio/${name}.mp3`, `/audio/${name}.ogg`],
        volume: this._effectiveVolume(name),
        preload: true,
        onloaderror: () => {
          // File not found — will use synth fallback
          this._sounds.delete(name);
        },
      });
      this._sounds.set(name, howl);
    }
  }

  private _effectiveVolume(name: SoundName): number {
    if (this._muted) return 0;
    const rel = VOLUME_MAP[name] ?? 0.6;
    return this._volume * rel;
  }

  play(name: SoundName) {
    if (!this._unlocked || this._muted) return;

    const vol = this._effectiveVolume(name);
    const howl = this._sounds.get(name);

    if (howl) {
      howl.volume(vol);
      if (PITCH_VARY.has(name)) {
        howl.rate(0.95 + Math.random() * 0.1);
      }
      howl.play();
      return;
    }

    // Synth fallback
    this._playSynth(name, vol);
  }

  private _playSynth(name: SoundName, vol: number) {
    const ctx = this._ctx;
    if (!ctx) return;
    const def = SYNTH_DEFS[name];
    if (!def) return;

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(vol * def.volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + def.duration);

    if (def.type === 'noise') {
      // White noise burst (for card shuffle/discard sounds)
      const bufferSize = ctx.sampleRate * def.duration;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      // Optional bandpass filter
      if (def.filterFreq) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = def.filterFreq;
        filter.Q.value = def.filterQ ?? 1;
        src.connect(filter);
        filter.connect(gain);
      } else {
        src.connect(gain);
      }
      src.start(now);
      src.stop(now + def.duration);
    } else {
      // Oscillator-based sounds
      const pitchVar = PITCH_VARY.has(name) ? (0.95 + Math.random() * 0.1) : 1;
      for (const note of def.notes) {
        const osc = ctx.createOscillator();
        osc.type = note.wave || def.type || 'sine';
        osc.frequency.setValueAtTime((note.freq ?? 440) * pitchVar, now + (note.start ?? 0));
        if (note.freqEnd) {
          osc.frequency.exponentialRampToValueAtTime(note.freqEnd * pitchVar, now + (note.start ?? 0) + (note.dur ?? def.duration));
        }
        const noteGain = ctx.createGain();
        noteGain.gain.setValueAtTime(vol * (note.vol ?? def.volume), now + (note.start ?? 0));
        noteGain.gain.exponentialRampToValueAtTime(0.001, now + (note.start ?? 0) + (note.dur ?? def.duration));
        osc.connect(noteGain);
        noteGain.connect(ctx.destination);
        osc.start(now + (note.start ?? 0));
        osc.stop(now + (note.start ?? 0) + (note.dur ?? def.duration));
      }
    }
  }

  get volume() { return this._volume; }
  set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('monopoly-audio-volume', String(this._volume));
    for (const [name, howl] of this._sounds) {
      howl.volume(this._effectiveVolume(name as SoundName));
    }
  }

  get muted() { return this._muted; }
  set muted(v: boolean) {
    this._muted = v;
    localStorage.setItem('monopoly-audio-muted', String(v));
    for (const [name, howl] of this._sounds) {
      howl.volume(this._effectiveVolume(name as SoundName));
    }
  }

  toggleMute() {
    this.muted = !this._muted;
  }
}

export const audioManager = new AudioManager();
