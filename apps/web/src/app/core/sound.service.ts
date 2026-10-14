import { Injectable, signal } from '@angular/core';
import type { GameEvent, PlayerId } from '@solo-poker/engine';

/*
 * Sonidos sintetizados con Web Audio: no hay ficheros que descargar y todos
 * comparten el mismo estilo corto y seco. Cada sonido es una pequeña receta
 * de osciladores y ruido filtrado con su envolvente de volumen.
 */

export type SoundName =
  | 'check'
  | 'call'
  | 'bet'
  | 'allIn'
  | 'fold'
  | 'deal'
  | 'yourTurn'
  | 'timeWarning'
  | 'potWon'
  | 'potLost'
  | 'blindsUp'
  | 'gameWon'
  | 'gameLost';

const MUTED_KEY = 'solo-poker:muted';
const MASTER_VOLUME = 0.55;
const CARD_STAGGER = 0.08;

@Injectable({ providedIn: 'root' })
export class SoundService {
  readonly muted = signal(readMuted());

  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  constructor() {
    // Los navegadores solo permiten sonar tras una interacción del usuario.
    const unlock = () => void this.ensureContext()?.resume();
    document.addEventListener('pointerdown', unlock, { once: true, capture: true });
    document.addEventListener('keydown', unlock, { once: true, capture: true });
  }

  toggleMuted(): void {
    this.muted.update((muted) => !muted);
    try {
      localStorage.setItem(MUTED_KEY, String(this.muted()));
    } catch {
      // Opcional.
    }
  }

  play(name: SoundName): void {
    if (this.muted()) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;
    RECIPES[name](this.tools(ctx), ctx.currentTime + 0.01);
  }

  /** Traduce los eventos de la partida en sonidos. `me` decide si el bote o la partida son tuyos. */
  playEvents(events: GameEvent[], me: PlayerId | null): void {
    let delay = 0;
    for (const event of events) {
      switch (event.type) {
        case 'handStarted':
          this.later('deal', delay);
          delay += 0.15;
          break;
        case 'playerActed':
          this.later(actionSound(event), delay);
          delay += 0.12;
          break;
        case 'streetDealt':
          this.later('deal', delay);
          delay += 0.15;
          break;
        case 'potAwarded':
          // Con varios botes basta un sonido: el primero es el principal.
          if (events.find((e) => e.type === 'potAwarded') === event) {
            this.later(me && event.winners.includes(me) ? 'potWon' : 'potLost', delay + 0.2);
          }
          break;
        case 'blindsIncreased':
          this.later('blindsUp', delay);
          break;
        case 'gameOver':
          this.later(event.winnerId === me ? 'gameWon' : 'gameLost', delay + 0.6);
          break;
        case 'playerEliminated':
          // Si la partida acaba en este mismo momento, ya suena el fin de partida.
          if (event.playerId === me && !events.some((e) => e.type === 'gameOver')) {
            this.later('gameLost', delay + 0.6);
          }
          break;
      }
    }
  }

  private later(name: SoundName, delaySeconds: number): void {
    if (delaySeconds <= 0) this.play(name);
    else setTimeout(() => this.play(name), delaySeconds * 1000);
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    if (typeof AudioContext === 'undefined') return null;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = MASTER_VOLUME;
    this.master.connect(this.context.destination);
    this.noise = createNoise(this.context);
    return this.context;
  }

  private tools(ctx: AudioContext): Tools {
    const master = this.master!;
    const noiseBuffer = this.noise!;

    /** Envolvente: sube en `attack` segundos hasta `peak` y cae exponencialmente durante `decay`. */
    const envelope = (t: number, peak: number, attack: number, decay: number) => {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      gain.connect(master);
      return gain;
    };

    return {
      tone(t, { freq, endFreq, type = 'sine', peak, attack = 0.005, decay }) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + attack + decay);
        osc.connect(envelope(t, peak, attack, decay));
        osc.start(t);
        osc.stop(t + attack + decay + 0.05);
      },
      noise(t, { filter, freq, endFreq, q = 1, peak, attack = 0.003, decay }) {
        const source = ctx.createBufferSource();
        source.buffer = noiseBuffer;
        const biquad = ctx.createBiquadFilter();
        biquad.type = filter;
        biquad.Q.value = q;
        biquad.frequency.setValueAtTime(freq, t);
        if (endFreq) biquad.frequency.exponentialRampToValueAtTime(endFreq, t + attack + decay);
        source.connect(biquad).connect(envelope(t, peak, attack, decay));
        source.start(t, Math.random() * 0.5);
        source.stop(t + attack + decay + 0.05);
      },
    };
  }
}

// ─── Recetas ────────────────────────────────────────────────────

interface Tools {
  tone(
    t: number,
    opts: { freq: number; endFreq?: number; type?: OscillatorType; peak: number; attack?: number; decay: number },
  ): void;
  noise(
    t: number,
    opts: { filter: BiquadFilterType; freq: number; endFreq?: number; q?: number; peak: number; attack?: number; decay: number },
  ): void;
}

type Recipe = (tools: Tools, t: number) => void;

/** Golpe con los nudillos en la mesa: un "tump" grave más un poco de ruido sordo. */
const knock: Recipe = (s, t) => {
  s.tone(t, { freq: 170, endFreq: 70, peak: 0.7, decay: 0.11 });
  s.noise(t, { filter: 'lowpass', freq: 900, peak: 0.3, decay: 0.05 });
};

/** Una ficha chocando con otra: un clic agudo y brillante. */
const chip: Recipe = (s, t) => {
  const freq = 3200 + Math.random() * 1400;
  s.tone(t, { freq, type: 'triangle', peak: 0.12, decay: 0.045 });
  s.tone(t, { freq: freq * 1.48, peak: 0.06, decay: 0.03 });
  s.noise(t, { filter: 'highpass', freq: 5000, peak: 0.08, decay: 0.02 });
};

const chips = (count: number, spread: number): Recipe => (s, t) => {
  for (let i = 0; i < count; i++) chip(s, t + (i * spread) / count + Math.random() * 0.015);
};

/** Una carta deslizándose sobre el tapete. */
const flick: Recipe = (s, t) => s.noise(t, { filter: 'highpass', freq: 2200, peak: 0.22, decay: 0.05 });

const note = (freq: number, peak = 0.14, decay = 0.22): Recipe => (s, t) =>
  s.tone(t, { freq, type: 'triangle', peak, attack: 0.008, decay });

const sequence = (recipes: Recipe[], gap: number): Recipe => (s, t) =>
  recipes.forEach((recipe, i) => recipe(s, t + i * gap));

const RECIPES: Record<SoundName, Recipe> = {
  check: sequence([knock, knock], 0.13),
  call: chips(2, 0.06),
  bet: chips(4, 0.12),
  allIn: chips(9, 0.35),
  // Las cartas tiradas: un "fsss" que baja de tono.
  fold: (s, t) => s.noise(t, { filter: 'bandpass', freq: 2600, endFreq: 700, q: 0.8, peak: 0.3, attack: 0.02, decay: 0.17 }),
  deal: sequence([flick, flick], CARD_STAGGER),
  yourTurn: sequence([note(660, 0.1, 0.14), note(880, 0.1, 0.2)], 0.11),
  timeWarning: sequence(
    [
      (s, t) => s.tone(t, { freq: 1050, peak: 0.16, decay: 0.07 }),
      (s, t) => s.tone(t, { freq: 1050, peak: 0.16, decay: 0.07 }),
    ],
    0.15,
  ),
  potWon: sequence([note(523), note(659), note(784, 0.14, 0.4)], 0.08),
  potLost: chips(3, 0.18),
  blindsUp: (s, t) => s.tone(t, { freq: 1318, type: 'triangle', peak: 0.1, decay: 0.5 }),
  gameWon: sequence([note(523), note(659), note(784), note(1046, 0.16, 0.6)], 0.11),
  gameLost: sequence([note(392, 0.12, 0.25), note(311, 0.12, 0.45)], 0.18),
};

// ─── Utilidades ─────────────────────────────────────────────────

function actionSound(event: Extract<GameEvent, { type: 'playerActed' }>): SoundName {
  if (event.allIn) return 'allIn';
  switch (event.action.type) {
    case 'check':
      return 'check';
    case 'call':
      return 'call';
    case 'raise':
      return 'bet';
    case 'fold':
      return 'fold';
  }
}

function createNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === 'true';
  } catch {
    return false;
  }
}
