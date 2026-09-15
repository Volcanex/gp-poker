#!/usr/bin/env node
/* Generates the "Old web" sound pack: fifteen original blips and chimes that
   evoke early-2000s desktop and messenger audio without copying any of it.
   Every sound is synthesised here, so the whole pack is CC0 and anyone can
   regenerate it byte for byte:

       node client/scripts/sound-web.mjs

   Output: one module per sound under client/src/sound/packs/web/, each a
   SoundAsset carrying a 22050 Hz mono 16-bit WAV as base64. Nothing is
   sampled, recorded or reconstructed from an existing recording. The era's
   real sounds are copyrighted; these are lookalikes built from oscillators
   and filtered noise.

   No dependencies: the WAV bytes are written by hand and the noise comes
   from a seeded generator, so a rerun produces identical files. */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 22050;
const OUT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'sound',
  'packs',
  'web',
);

/* The provenance test greps every vendored file, base64 included, for the
   names of the collection this repo must never ship. A random blob can spell
   one of them by accident, so the generator checks its own output and nudges
   the length by a sample until it does not. */
const FORBIDDEN = /bell-toll|blizzard|voiceover-pack|quest|warcraft|alliance|horde|night-elf/i;

const FADE_IN_MS = 5;
const FADE_OUT_MS = 25;
const PEAK_DBFS = -3;

/* One gentler than the rest: the turn chime fires on every hand and a chime at
   the same peak as the win fanfare wears thin. A literal 60 percent of -3 dBFS
   would sit at -7.4 dBFS, under the floor the pack test enforces, so it goes
   as quiet as that floor allows. */
const CHIME_DBFS = -5.5;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TWO_PI = Math.PI * 2;
const NYQUIST_GUARD = 9500;

function sineAt(phase) {
  return Math.sin(phase);
}

/* Band-limited by summing only the harmonics that fit under the guard: a naive
   square at 1.3 kHz on a 22 kHz rate folds its upper harmonics back down as
   grit, which reads as a broken file rather than as a period blip. */
function squareAt(phase, freq) {
  let out = 0;
  for (let k = 1; k * freq < NYQUIST_GUARD; k += 2) out += Math.sin(k * phase) / k;
  return out * (4 / Math.PI) * 0.25;
}

function triangleAt(phase, freq) {
  let out = 0;
  for (let k = 1; k * freq < NYQUIST_GUARD; k += 2) {
    out += (((k - 1) / 2) % 2 === 0 ? 1 : -1) * (Math.sin(k * phase) / (k * k));
  }
  return out * (8 / (Math.PI * Math.PI));
}

/* A voice is a phase accumulator plus a waveform, so a note can glide, wobble
   or take a modulator without the shape breaking up at the seams. */
function voice(kind) {
  let phase = 0;
  return (freq, fm = 0) => {
    phase += (TWO_PI * freq) / SR;
    if (phase > TWO_PI) phase -= TWO_PI;
    if (kind === 'sine') return sineAt(phase + fm);
    if (kind === 'square') return squareAt(phase + fm, freq);
    return triangleAt(phase + fm, freq);
  };
}

function lowpass(cutoff) {
  const a = 1 - Math.exp((-TWO_PI * cutoff) / SR);
  let y = 0;
  return (x) => {
    y += a * (x - y);
    return y;
  };
}

/* One-pole highpass, for sparkle above where the state-variable filter below
   is safe to run. */
function highpass(cutoff) {
  const a = 1 - Math.exp((-TWO_PI * cutoff) / SR);
  let y = 0;
  return (x) => {
    y += a * (x - y);
    return x - y;
  };
}

/* State-variable bandpass: cheap, zero-mean output, which keeps the noise
   clicks from carrying a thump. Stable only well below a third of the sample
   rate, so anything brighter than about 3.5 kHz uses the highpass instead. */
function bandpass(centre, q) {
  const f = 2 * Math.sin((Math.PI * centre) / SR);
  const damp = 1 / q;
  let low = 0;
  let band = 0;
  return (x) => {
    const high = x - low - damp * band;
    band += f * high;
    low += f * band;
    return band;
  };
}

function decay(t, tau) {
  return Math.exp(-t / tau);
}

function samples(ms) {
  return Math.round((ms / 1000) * SR);
}

function buffer(ms) {
  return new Float32Array(samples(ms));
}

/* Adds one note into a buffer at an offset, so notes can ring over each other
   the way a chime does rather than being butted end to end. */
function addNote(buf, opts) {
  const {
    start = 0,
    length,
    kind = 'sine',
    freq,
    freqEnd = null,
    gain = 1,
    tau = 0.08,
    attackMs = 3,
    fmRatio = 0,
    fmIndex = 0,
    vibratoHz = 0,
    vibratoCents = 0,
  } = opts;
  const from = samples(start);
  const count = Math.min(samples(length), buf.length - from);
  const osc = voice(kind);
  const mod = voice('sine');
  const attack = Math.max(1, samples(attackMs));
  for (let i = 0; i < count; i++) {
    const t = i / SR;
    const progress = count > 1 ? i / (count - 1) : 0;
    let f = freqEnd === null ? freq : freq + (freqEnd - freq) * progress;
    if (vibratoHz > 0) {
      f *= Math.pow(2, (vibratoCents / 1200) * Math.sin(TWO_PI * vibratoHz * t));
    }
    const fm = fmIndex > 0 ? fmIndex * mod(f * fmRatio) : 0;
    const env = Math.min(1, i / attack) * decay(t, tau);
    buf[from + i] += osc(f, fm) * env * gain;
  }
}

function addNoise(buf, opts) {
  const { start = 0, length, seed, tau = 0.01, gain = 1, filter } = opts;
  const from = samples(start);
  const count = Math.min(samples(length), buf.length - from);
  const rnd = mulberry32(seed);
  const shape = filter();
  for (let i = 0; i < count; i++) {
    const t = i / SR;
    buf[from + i] += shape(rnd() * 2 - 1) * decay(t, tau) * gain;
  }
}

/* Fades in on a cubic and out on a square: both curves leave the first and
   last milliseconds genuinely quiet, which is what stops the buffer starting
   or ending on a step the speaker reproduces as a click. */
function finish(buf, targetDbfs = PEAK_DBFS) {
  const fadeIn = samples(FADE_IN_MS);
  const fadeOut = Math.min(samples(FADE_OUT_MS), Math.floor(buf.length * 0.35));
  for (let i = 0; i < fadeIn && i < buf.length; i++) {
    const g = i / fadeIn;
    buf[i] *= g * g * g;
  }
  for (let i = 0; i < fadeOut; i++) {
    const g = i / fadeOut;
    buf[buf.length - 1 - i] *= g * g;
  }
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  /* A filter that went unstable leaves NaN behind, which normalises to a
     silent file. Say so here rather than shipping a sound nobody can hear. */
  if (!(peak > 0)) throw new Error(`synthesis produced no signal (peak ${peak})`);
  const target = Math.pow(10, targetDbfs / 20);
  const scale = target / peak;
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const v = Math.max(-1, Math.min(1, buf[i] * scale));
    out[i] = Math.round(v * 32767);
  }
  out[0] = 0;
  out[out.length - 1] = 0;
  return out;
}

function wav(pcm) {
  const dataBytes = pcm.length * 2;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write('WAVE', 8, 'ascii');
  bytes.write('fmt ', 12, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(SR, 24);
  bytes.writeUInt32LE(SR * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < pcm.length; i++) bytes.writeInt16LE(pcm[i], 44 + i * 2);
  return bytes;
}

/* The eighteen sounds. Waveform and length carry the character: ticks are
   filtered noise, actions are square and triangle blips, and the chimes and
   fanfares are sines with a little FM so the pack does not sound like one
   instrument playing everything. */
const SOUNDS = {
  /* Dealing: a soft, dry tick with a hint of body under it. */
  deal: () => {
    const buf = buffer(70);
    addNoise(buf, { length: 70, seed: 101, tau: 0.012, gain: 0.9, filter: () => lowpass(2600) });
    addNote(buf, { length: 70, kind: 'sine', freq: 190, gain: 0.25, tau: 0.02, attackMs: 1 });
    return { buf, ms: 70 };
  },
  /* A card landing: the same tick, higher and harder. */
  cardPlace: () => {
    const buf = buffer(60);
    addNoise(buf, { length: 60, seed: 202, tau: 0.008, gain: 1, filter: () => bandpass(1600, 1.4) });
    return { buf, ms: 60 };
  },
  /* Betting: two square blips climbing, the second gliding up like a handshake
     tone finding its partner. */
  bet: () => {
    const buf = buffer(110);
    addNote(buf, { length: 52, kind: 'square', freq: 587, gain: 0.7, tau: 0.05, attackMs: 2 });
    addNote(buf, {
      start: 52,
      length: 58,
      kind: 'square',
      freq: 880,
      freqEnd: 932,
      gain: 0.7,
      tau: 0.05,
      attackMs: 2,
    });
    return { buf, ms: 110 };
  },
  /* Calling: one flat triangle tone, the plainest cue in the pack. */
  call: () => {
    const buf = buffer(90);
    addNote(buf, { length: 90, kind: 'triangle', freq: 740, gain: 1, tau: 0.06, attackMs: 3 });
    return { buf, ms: 90 };
  },
  /* Checking: a muted tap, mostly low noise with a short thump. */
  check: () => {
    const buf = buffer(70);
    addNoise(buf, { length: 70, seed: 303, tau: 0.018, gain: 0.8, filter: () => lowpass(900) });
    addNote(buf, { length: 70, kind: 'sine', freq: 200, gain: 0.5, tau: 0.03, attackMs: 2 });
    return { buf, ms: 70 };
  },
  /* Folding: the bet blip inverted, two squares stepping down. */
  fold: () => {
    const buf = buffer(110);
    addNote(buf, { length: 52, kind: 'square', freq: 698, gain: 0.7, tau: 0.05, attackMs: 2 });
    addNote(buf, { start: 52, length: 58, kind: 'square', freq: 466, gain: 0.7, tau: 0.06, attackMs: 2 });
    return { buf, ms: 110 };
  },
  /* Chips sweeping in: three quick triangle notes with a little sparkle over
     the top of them. */
  chipsCollect: () => {
    const buf = buffer(160);
    const notes = [880, 1109, 1319];
    notes.forEach((freq, i) => {
      addNote(buf, {
        start: i * 48,
        length: 160 - i * 48,
        kind: 'triangle',
        freq,
        gain: 0.55,
        tau: 0.045,
        attackMs: 2,
      });
    });
    addNoise(buf, { length: 160, seed: 404, tau: 0.03, gain: 0.18, filter: () => highpass(4200) });
    return { buf, ms: 160 };
  },
  /* Your turn: the message-received chime, two sine notes a fourth apart with
     a touch of FM for shimmer. The one sound in the pack people will hear a
     hundred times an evening, so it stays soft. */
  yourTurn: () => {
    const buf = buffer(300);
    addNote(buf, {
      length: 300,
      kind: 'sine',
      freq: 987.77,
      gain: 0.6,
      tau: 0.11,
      attackMs: 5,
      fmRatio: 2,
      fmIndex: 0.35,
    });
    addNote(buf, {
      start: 105,
      length: 195,
      kind: 'sine',
      freq: 1318.51,
      gain: 0.7,
      tau: 0.1,
      attackMs: 5,
      fmRatio: 2,
      fmIndex: 0.3,
    });
    return { buf, ms: 300, dbfs: CHIME_DBFS };
  },
  /* Clock running out: two hard square beeps, close enough together to nag. */
  clockWarning: () => {
    const buf = buffer(220);
    addNote(buf, { length: 80, kind: 'square', freq: 1245, gain: 0.8, tau: 0.09, attackMs: 2 });
    addNote(buf, { start: 130, length: 90, kind: 'square', freq: 1245, gain: 0.8, tau: 0.09, attackMs: 2 });
    return { buf, ms: 220 };
  },
  /* The run-out and hand-hold count: one dry click a second, filtered
     tighter and shorter than a card landing so three of them in a row read
     as counting rather than as dealing. Quieter than the rest of the pack for
     the same reason the turn chime is: it fires three times a hand. */
  tick: () => {
    const buf = buffer(70);
    addNoise(buf, { length: 70, seed: 909, tau: 0.006, gain: 1, filter: () => bandpass(2400, 1.8) });
    return { buf, ms: 70, dbfs: -5.5 };
  },
  /* The ready check arriving: a two-note call up a fifth with a little FM on
     it, the shape of a doorbell rather than of a notification. It is the one
     sound on this site meant to reach somebody who is looking at another tab,
     so it is the longest of the short ones and it rings rather than clicks. */
  readyCheck: () => {
    const buf = buffer(280);
    addNote(buf, {
      length: 170, kind: 'sine', freq: 659.26, gain: 0.7, tau: 0.1, attackMs: 4,
      fmRatio: 2, fmIndex: 0.3,
    });
    addNote(buf, {
      start: 110, length: 170, kind: 'sine', freq: 987.77, gain: 0.7, tau: 0.11, attackMs: 4,
      fmRatio: 2, fmIndex: 0.3,
    });
    return { buf, ms: 280 };
  },
  /* Accepting it: two quick triangle notes an octave apart, short and dry.
     Nothing celebratory, because taking a seat is not winning anything: it is
     the sound of a switch closing. */
  readyAccept: () => {
    const buf = buffer(140);
    addNote(buf, { length: 60, kind: 'triangle', freq: 784, gain: 0.8, tau: 0.045, attackMs: 2 });
    addNote(buf, { start: 55, length: 85, kind: 'triangle', freq: 1568, gain: 0.7, tau: 0.05, attackMs: 2 });
    return { buf, ms: 140, dbfs: CHIME_DBFS };
  },
  /* Hand won: four notes up an E chord, ringing into each other. */
  handWon: () => {
    const buf = buffer(320);
    const notes = [659.26, 783.99, 987.77, 1318.51];
    notes.forEach((freq, i) => {
      addNote(buf, {
        start: i * 70,
        length: 320 - i * 70,
        kind: 'sine',
        freq,
        gain: 0.55,
        tau: 0.09,
        attackMs: 3,
        fmRatio: 3,
        fmIndex: 0.25,
      });
    });
    return { buf, ms: 320 };
  },
  /* Hand lost: two triangle notes falling, no drama. */
  handLost: () => {
    const buf = buffer(210);
    addNote(buf, { length: 105, kind: 'triangle', freq: 440, gain: 0.8, tau: 0.07, attackMs: 3 });
    addNote(buf, { start: 100, length: 110, kind: 'triangle', freq: 329.63, gain: 0.8, tau: 0.08, attackMs: 3 });
    return { buf, ms: 210 };
  },
  /* Match won: a short square fanfare, C major up to a held top note with a
     slow wobble on it. */
  matchWon: () => {
    const buf = buffer(700);
    const rise = [523.25, 659.26, 783.99];
    rise.forEach((freq, i) => {
      addNote(buf, {
        start: i * 80,
        length: 110,
        kind: 'square',
        freq,
        gain: 0.55,
        tau: 0.07,
        attackMs: 2,
      });
    });
    addNote(buf, {
      start: 240,
      length: 460,
      kind: 'square',
      freq: 1046.5,
      gain: 0.6,
      tau: 0.22,
      attackMs: 3,
      vibratoHz: 6,
      vibratoCents: 22,
    });
    addNote(buf, {
      start: 240,
      length: 460,
      kind: 'triangle',
      freq: 523.25,
      gain: 0.35,
      tau: 0.22,
      attackMs: 3,
    });
    return { buf, ms: 700 };
  },
  /* Match lost: three notes walking down, triangle so it lands soft. */
  matchLost: () => {
    const buf = buffer(350);
    addNote(buf, { length: 120, kind: 'triangle', freq: 493.88, gain: 0.8, tau: 0.08, attackMs: 3 });
    addNote(buf, { start: 110, length: 130, kind: 'triangle', freq: 415.3, gain: 0.8, tau: 0.08, attackMs: 3 });
    addNote(buf, { start: 220, length: 130, kind: 'triangle', freq: 329.63, gain: 0.8, tau: 0.1, attackMs: 3 });
    return { buf, ms: 350 };
  },
  /* Chat: a soft pop, a sine dropping fast in pitch. */
  chat: () => {
    const buf = buffer(90);
    addNote(buf, {
      length: 90,
      kind: 'sine',
      freq: 1000,
      freqEnd: 420,
      gain: 1,
      tau: 0.022,
      attackMs: 2,
    });
    return { buf, ms: 90 };
  },
  /* Click: the smallest thing in the pack, a filtered noise tick. */
  click: () => {
    const buf = buffer(60);
    addNoise(buf, { length: 60, seed: 505, tau: 0.005, gain: 1, filter: () => bandpass(3000, 1.1) });
    return { buf, ms: 60 };
  },
};

const FILE_NAMES = {
  deal: 'deal',
  cardPlace: 'card-place',
  bet: 'bet',
  call: 'call',
  check: 'check',
  fold: 'fold',
  chipsCollect: 'chips-collect',
  yourTurn: 'your-turn',
  clockWarning: 'clock-warning',
  tick: 'tick',
  readyCheck: 'ready-check',
  readyAccept: 'ready-accept',
  handWon: 'hand-won',
  handLost: 'hand-lost',
  matchWon: 'match-won',
  matchLost: 'match-lost',
  chat: 'chat',
  click: 'click',
};

function moduleSource(exportName, name, base64, duration) {
  return `/* Generated by client/scripts/sound-web.mjs. Original synthesis, not a
   recording: rerun the script rather than editing this file by hand. */
import type { SoundAsset } from "../../sound-types.ts";

export const ${exportName}: SoundAsset = {
  name: "${name}",
  dataUri: "data:audio/wav;base64,${base64}",
  duration: ${duration.toFixed(3)},
  format: "wav",
  license: "CC0",
  author: "EveryonePoker",
};
`;
}

function packIndexSource(entries) {
  const imports = entries
    .map((e) => `import { ${e.exportName} } from './${e.file}.ts';`)
    .join('\n');
  const mapping = entries.map((e) => `    ${e.event}: ${e.exportName},`).join('\n');
  return `import type { SoundEvent } from '../../events.ts';
import type { SoundModule } from '../../sound-types.ts';
${imports}

export const web: {
  id: string;
  name: string;
  description: string;
  sounds: Record<SoundEvent, SoundModule | null>;
} = {
  id: 'web',
  name: 'Old web',
  description: 'Blips and chimes from the dial-up years.',
  sounds: {
${mapping}
  },
};

export default web;
`;
}

mkdirSync(OUT_DIR, { recursive: true });

const entries = [];
let totalBase64 = 0;

for (const [event, make] of Object.entries(SOUNDS)) {
  const file = FILE_NAMES[event];
  const exportName = `${event}Sound`;
  const name = `web-${file}`;

  let pad = 0;
  let source = '';
  let base64 = '';
  let pcm = null;
  /* Regenerate with one more sample of tail until the base64 spells nothing
     the provenance test forbids. It never takes more than a pass or two. */
  for (;;) {
    const made = make();
    const padded = new Float32Array(made.buf.length + pad);
    padded.set(made.buf, 0);
    pcm = finish(padded, made.dbfs ?? PEAK_DBFS);
    base64 = wav(pcm).toString('base64');
    source = moduleSource(exportName, name, base64, pcm.length / SR);
    if (!FORBIDDEN.test(source)) break;
    pad += 1;
  }

  writeFileSync(path.join(OUT_DIR, `${file}.ts`), source);
  totalBase64 += base64.length;

  let peak = 0;
  for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  entries.push({ event, file, exportName, name, samples: pcm.length, peak, base64: base64.length });
}

writeFileSync(path.join(OUT_DIR, 'index.ts'), packIndexSource(entries));

const width = Math.max(...entries.map((e) => e.event.length));
for (const e of entries) {
  const ms = ((e.samples / SR) * 1000).toFixed(0).padStart(4);
  const dbfs = (20 * Math.log10(e.peak / 32767)).toFixed(2).padStart(6);
  const kb = (e.base64 / 1024).toFixed(1).padStart(6);
  console.log(`${e.event.padEnd(width)}  ${ms} ms  ${dbfs} dBFS  ${kb} KB`);
}
console.log(
  `\n${entries.length} sounds, ${(totalBase64 / 1024).toFixed(1)} KB of base64 total ` +
    `(budget 200 KB).`,
);
