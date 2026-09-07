// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { soundEvents } from '../sound/events.ts';
import { felt } from '../sound/packs/felt/index.ts';
import { arcade } from '../sound/packs/arcade/index.ts';
import { glass } from '../sound/packs/glass/index.ts';

const SOUND_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sound');
const STORAGE_KEY = 'ot.sound';

const PACKS = [felt, arcade, glass];

function walkVendoredFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkVendoredFiles(full));
    } else if (entry.endsWith('.ts') && entry !== 'index.ts') {
      out.push(full);
    }
  }
  return out;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock('../sound/packs/felt/index.ts');
});

describe('packs', () => {
  it('map every sound event', () => {
    for (const pack of PACKS) {
      expect(Object.keys(pack.sounds).sort()).toEqual([...soundEvents].sort());
    }
  });

  it('have unique ids', () => {
    const ids = PACKS.map((pack) => pack.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('provenance', () => {
  const forbidden = /bell-toll|blizzard|voiceover-pack|quest|warcraft|alliance|horde|night-elf/i;

  it('vendors no sound whose name or content matches the forbidden Warcraft/Blizzard collection', () => {
    const files = walkVendoredFiles(path.join(SOUND_DIR, 'packs'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const name = path.basename(file, '.ts');
      expect(name).not.toMatch(forbidden);
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(forbidden);
      expect(content).toMatch(/author:\s*"Kenney"/);
      expect(content).toMatch(/license:\s*"CC0"/);
    }
  });
});

describe('persistence', () => {
  it('falls back to defaults with nothing stored', async () => {
    const mod = await import('../sound/index.ts');
    expect(mod.sound.state).toEqual({ enabled: false, volume: 0.6, pack: 'felt' });
  });

  it('loads persisted state on init', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: true, volume: 0.3, pack: 'glass' }));
    const mod = await import('../sound/index.ts');
    expect(mod.sound.state).toEqual({ enabled: true, volume: 0.3, pack: 'glass' });
  });

  it('round-trips writes through localStorage', async () => {
    const mod = await import('../sound/index.ts');
    mod.sound.setEnabled(true);
    mod.sound.setVolume(0.9);
    mod.sound.setPack('arcade');

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored).toEqual({ enabled: true, volume: 0.9, pack: 'arcade' });

    vi.resetModules();
    const reloaded = await import('../sound/index.ts');
    expect(reloaded.sound.state).toEqual({ enabled: true, volume: 0.9, pack: 'arcade' });
  });

  it('ignores a garbage stored value rather than throwing', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'not json');
    const mod = await import('../sound/index.ts');
    expect(mod.sound.state).toEqual({ enabled: false, volume: 0.6, pack: 'felt' });
  });
});

describe('playback gating', () => {
  it('is a no-op before unlock and never throws', async () => {
    const mod = await import('../sound/index.ts');
    mod.sound.setEnabled(true);
    await expect(mod.sound.play('deal')).resolves.toBeUndefined();
  });

  it('is a no-op while disabled', async () => {
    const mod = await import('../sound/index.ts');
    await mod.sound.unlock();
    await expect(mod.sound.play('deal')).resolves.toBeUndefined();
  });
});

describe('pack loading', () => {
  it('loads a pack lazily via dynamic import, once per pack', async () => {
    let loadCount = 0;
    vi.doMock('../sound/packs/felt/index.ts', () => {
      loadCount += 1;
      return {
        default: {
          id: 'felt',
          name: 'Felt',
          description: 'mock',
          sounds: Object.fromEntries(soundEvents.map((event) => [event, null])),
        },
      };
    });

    const mod = await import('../sound/index.ts');
    expect(loadCount).toBe(0);

    mod.sound.setEnabled(true);
    mod.sound.setPack('felt');
    await mod.sound.play('deal');
    await mod.sound.play('cardPlace');

    expect(loadCount).toBe(1);
  });

  it('exposes pack metadata without loading any audio module', async () => {
    const mod = await import('../sound/index.ts');
    expect(mod.sound.packs).toEqual([
      { id: 'felt', name: 'Felt', description: expect.any(String) },
      { id: 'arcade', name: 'Arcade', description: expect.any(String) },
      { id: 'glass', name: 'Glass', description: expect.any(String) },
    ]);
  });
});
