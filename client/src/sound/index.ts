import * as engine from './engine.ts';
import type { SoundEvent } from './events.ts';
import type { SoundModule } from './sound-types.ts';

export type { SoundEvent } from './events.ts';
export type { SoundModule } from './sound-types.ts';

export interface SoundPack {
  id: string;
  name: string;
  description: string;
  sounds: Record<SoundEvent, SoundModule | null>;
}

const PACK_META = [
  { id: 'felt', name: 'Felt', description: 'Real foley: cards, chips and cloth on a poker table.' },
  { id: 'arcade', name: 'Arcade', description: '8-bit blips, mostly short clicks with jingles saved for wins.' },
  { id: 'glass', name: 'Glass', description: 'Quiet, glassy chimes, like an old desktop notification.' },
] as const;

export type PackId = (typeof PACK_META)[number]['id'];

const packLoaders: Record<PackId, () => Promise<{ default: SoundPack }>> = {
  felt: () => import('./packs/felt/index.ts'),
  arcade: () => import('./packs/arcade/index.ts'),
  glass: () => import('./packs/glass/index.ts'),
};

export interface SoundState {
  enabled: boolean;
  volume: number;
  pack: PackId;
}

const STORAGE_KEY = 'ot.sound';
const DEFAULT_STATE: SoundState = { enabled: false, volume: 0.6, pack: 'felt' };

function isPackId(value: unknown): value is PackId {
  return typeof value === 'string' && PACK_META.some((p) => p.id === value);
}

function loadState(): SoundState {
  if (typeof window === 'undefined') return { ...DEFAULT_STATE };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<SoundState>;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_STATE.enabled,
      volume: typeof parsed.volume === 'number' ? parsed.volume : DEFAULT_STATE.volume,
      pack: isPackId(parsed.pack) ? parsed.pack : DEFAULT_STATE.pack,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(next: SoundState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable; state stays in memory for this session.
  }
}

let state: SoundState = loadState();
engine.setEnabled(state.enabled);
engine.setVolume(state.volume);

const packCache = new Map<PackId, Promise<SoundPack>>();

function loadPack(id: PackId): Promise<SoundPack> {
  let pending = packCache.get(id);
  if (!pending) {
    pending = packLoaders[id]().then((mod) => mod.default);
    packCache.set(id, pending);
  }
  return pending;
}

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function play(event: SoundEvent): Promise<void> {
  if (!state.enabled) return;
  const pack = await loadPack(state.pack);
  await engine.play(pack.sounds[event]);
}

export function setEnabled(next: boolean): void {
  state = { ...state, enabled: next };
  saveState(state);
  engine.setEnabled(next);
  notify();
}

export function setVolume(next: number): void {
  const volume = Math.max(0, Math.min(1, next));
  state = { ...state, volume };
  saveState(state);
  engine.setVolume(volume);
  notify();
}

export function setPack(id: PackId): void {
  state = { ...state, pack: id };
  saveState(state);
  void loadPack(id);
  notify();
}

export async function unlock(): Promise<void> {
  await engine.unlock();
  notify();
}

export const sound = {
  play,
  setEnabled,
  setVolume,
  setPack,
  unlock,
  subscribe,
  packs: PACK_META as unknown as ReadonlyArray<{ id: PackId; name: string; description: string }>,
  get state(): SoundState {
    return { ...state };
  },
};

export default sound;
