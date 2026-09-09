import type { SoundModule } from './sound-types.ts';

let ctx: AudioContext | null = null;
let ctxChecked = false;
let unlocked = false;
let enabled = false;
let volume = 0.6;
const bufferCache = new Map<string, AudioBuffer>();

function getContext(): AudioContext | null {
  if (ctxChecked) return ctx;
  ctxChecked = true;
  const Ctor = typeof window !== 'undefined' ? window.AudioContext : undefined;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

export function isAvailable(): boolean {
  return getContext() !== null;
}

export function setEnabled(next: boolean): void {
  enabled = next;
}

export function setVolume(next: number): void {
  volume = Math.max(0, Math.min(1, next));
}

export function isUnlocked(): boolean {
  return unlocked;
}

export async function unlock(): Promise<void> {
  const audio = getContext();
  if (!audio) return;
  if (audio.state === 'suspended') {
    try {
      await audio.resume();
    } catch {
      return;
    }
  }
  unlocked = true;
}

function decodeBase64(dataUri: string): ArrayBuffer {
  const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function getBuffer(sound: SoundModule, audio: AudioContext): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(sound.dataUri);
  if (cached) return cached;
  try {
    const buffer = await audio.decodeAudioData(decodeBase64(sound.dataUri));
    bufferCache.set(sound.dataUri, buffer);
    return buffer;
  } catch {
    return null;
  }
}

/* How the same sound can be played twice and not sound twice the same. One
   knob only: the rate the buffer is read back at, which moves the pitch and
   the length together the way speeding up a record does. It is what lets a
   countdown climb without a second file per step. */
export interface PlayOptions {
  rate?: number;
}

/* Anything outside this is a different sound rather than the same one under
   tension, and a rate at or below zero stops the buffer dead. */
const MIN_RATE = 0.25;
const MAX_RATE = 4;

export async function play(sound: SoundModule | null | undefined, opts: PlayOptions = {}): Promise<void> {
  if (!sound || !enabled || !unlocked) return;
  const audio = getContext();
  if (!audio) return;
  const buffer = await getBuffer(sound, audio);
  if (!buffer) return;
  const source = audio.createBufferSource();
  const gain = audio.createGain();
  source.buffer = buffer;
  if (opts.rate !== undefined && Number.isFinite(opts.rate)) {
    source.playbackRate.value = Math.max(MIN_RATE, Math.min(MAX_RATE, opts.rate));
  }
  gain.gain.value = volume;
  source.connect(gain);
  gain.connect(audio.destination);
  source.start(0);
}
