import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { soundEvents } from '../sound/events.ts';
import type { SoundEvent } from '../sound/events.ts';
import type { SoundModule } from '../sound/sound-types.ts';
import { web } from '../sound/packs/web/index.ts';

/* The web pack is synthesised, not vendored, so nobody can listen to a diff to
   see whether a regeneration broke it. These are the properties a listener
   would notice: the right rate, sensible lengths, a level that matches the
   rest of the packs, and silence at both ends where a click would live. */

const PACK_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'sound',
  'packs',
  'web',
);

const SAMPLE_RATE = 22050;
const MIN_SECONDS = 0.06;
const MAX_SECONDS = 0.9;
const FULL_SCALE = 32768;
/* The 5 ms fade in is still climbing 64 samples (2.9 ms) in, so "silent" here
   means an order of magnitude under the peak, not zero. The tail has fully
   decayed by then, so it is held to a much tighter bound. */
const HEAD_LIMIT = 0.2;
const TAIL_LIMIT = 0.05;

interface Decoded {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  audioFormat: number;
  samples: Int16Array;
}

function decodeWav(dataUri: string): Decoded {
  const comma = dataUri.indexOf(',');
  expect(dataUri.slice(0, comma)).toBe('data:audio/wav;base64');
  const bytes = Buffer.from(dataUri.slice(comma + 1), 'base64');

  expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(bytes.subarray(8, 12).toString('ascii')).toBe('WAVE');
  expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);

  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let samples = new Int16Array(0);

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.subarray(offset, offset + 4).toString('ascii');
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      audioFormat = bytes.readUInt16LE(body);
      channels = bytes.readUInt16LE(body + 2);
      sampleRate = bytes.readUInt32LE(body + 4);
      bitsPerSample = bytes.readUInt16LE(body + 14);
    } else if (id === 'data') {
      samples = new Int16Array(size / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(body + i * 2);
    }
    offset = body + size + (size % 2);
  }

  return { audioFormat, channels, sampleRate, bitsPerSample, samples };
}

function peakOf(samples: Int16Array, from: number, to: number): number {
  let peak = 0;
  for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return peak / FULL_SCALE;
}

function dbfs(level: number): number {
  return 20 * Math.log10(level);
}

const entries: Array<[SoundEvent, SoundModule]> = soundEvents.map((event) => {
  const module = web.sounds[event];
  if (!module) throw new Error(`the web pack has no sound for ${event}`);
  return [event, module];
});

describe('the web pack', () => {
  it('gives every event a sound', () => {
    expect(entries.length).toBe(soundEvents.length);
  });

  it.each(entries)('%s is a 22050 Hz mono 16-bit wav', (_event, module) => {
    const wav = decodeWav(module.dataUri);
    expect(wav.audioFormat).toBe(1);
    expect(wav.channels).toBe(1);
    expect(wav.sampleRate).toBe(SAMPLE_RATE);
    expect(wav.bitsPerSample).toBe(16);
    expect(module.format).toBe('wav');
  });

  it.each(entries)('%s lasts between 60 and 900 ms, as declared', (_event, module) => {
    const wav = decodeWav(module.dataUri);
    const seconds = wav.samples.length / wav.sampleRate;
    expect(seconds).toBeGreaterThanOrEqual(MIN_SECONDS);
    expect(seconds).toBeLessThanOrEqual(MAX_SECONDS);
    expect(Math.abs(seconds - module.duration)).toBeLessThan(0.002);
  });

  it.each(entries)('%s peaks between -6 and -1 dBFS', (_event, module) => {
    const wav = decodeWav(module.dataUri);
    const peak = dbfs(peakOf(wav.samples, 0, wav.samples.length));
    expect(peak).toBeGreaterThan(-6);
    expect(peak).toBeLessThan(-1);
  });

  it.each(entries)('%s starts and ends quiet enough not to click', (_event, module) => {
    const wav = decodeWav(module.dataUri);
    const n = wav.samples.length;
    expect(wav.samples[0]).toBe(0);
    expect(wav.samples[n - 1]).toBe(0);
    expect(peakOf(wav.samples, 0, 64)).toBeLessThan(HEAD_LIMIT);
    expect(peakOf(wav.samples, n - 64, n)).toBeLessThan(TAIL_LIMIT);
  });

  it('carries no dc offset a speaker would have to swallow', () => {
    for (const [event, module] of entries) {
      const wav = decodeWav(module.dataUri);
      let sum = 0;
      for (const v of wav.samples) sum += v;
      const mean = Math.abs(sum / wav.samples.length) / FULL_SCALE;
      expect(mean, event).toBeLessThan(0.02);
    }
  });

  /* 220 KB, raised from 200 when the ready check's two sounds landed. The
     repo's per-pack ceiling is 250 KB (`../sound/CLAUDE.md`); this is the
     tighter line web is held to, because uncompressed WAV costs about 59 KB
     of base64 a second and this pack is where a careless sound gets
     expensive. Eighteen sounds do not fit a line drawn for fifteen, and the
     pack is a lazily-loaded chunk only a player who picks it ever fetches. */
  it('stays under the 220 KB base64 budget', () => {
    const bytes = readdirSync(PACK_DIR)
      .filter((entry) => entry.endsWith('.ts') && entry !== 'index.ts')
      .reduce((total, entry) => total + statSync(path.join(PACK_DIR, entry)).size, 0);
    expect(bytes).toBeLessThan(220 * 1024);
  });
});
