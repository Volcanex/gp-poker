import { describe, expect, it } from 'vitest';
import {
  backupCheck,
  botsCheck,
  diskCheck,
  ladderCheck,
  BACKUP_MAX_AGE_MS,
  DISK_MIN_BYTES,
  type Check,
} from './health.js';

/* The composition of /health needs a live database and a loaded bot roster,
   so what is tested here is the part that decides: each check's threshold,
   and the rule that the top-level ok is the and of them. That rule is what a
   deploy gate and brain's L5 probe both read. */

const NOW = Date.parse('2026-09-08T12:00:00Z');

function ok(checks: Record<string, Check>): boolean {
  return Object.values(checks).every((c) => c.ok);
}

describe('backup check', () => {
  it('says so plainly when there is no dump', () => {
    expect(backupCheck(null, NOW)).toEqual({ ok: false, detail: 'no dump yet' });
  });

  it('passes a dump younger than the window and reports its age', () => {
    const check = backupCheck({ name: 'opentable-20260908.sql.gz', mtimeMs: NOW - 3_600_000 }, NOW);
    expect(check.ok).toBe(true);
    expect(check.detail).toBe('opentable-20260908.sql.gz, 1.0h old');
  });

  it('fails a dump older than the window', () => {
    const check = backupCheck({ name: 'old.sql.gz', mtimeMs: NOW - BACKUP_MAX_AGE_MS - 1 }, NOW);
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('36.0h old');
  });
});

describe('disk check', () => {
  it('fails at or below the floor and passes above it', () => {
    expect(diskCheck(DISK_MIN_BYTES).ok).toBe(false);
    expect(diskCheck(DISK_MIN_BYTES + 1).ok).toBe(true);
    expect(diskCheck(4 * 1024 ** 3).detail).toContain('4.00 GB free');
  });
});

describe('bots check', () => {
  it('wants the whole roster loaded', () => {
    expect(botsCheck(15, 15)).toEqual({ ok: true, detail: '15/15 bots loaded' });
    expect(botsCheck(14, 15).ok).toBe(false);
  });
});

describe('ladder check', () => {
  it('is healthy disabled, idle, or running', () => {
    expect(ladderCheck(false, null)).toEqual({ ok: true, detail: 'disabled' });
    expect(ladderCheck(true, null)).toEqual({ ok: true, detail: 'enabled, idle' });
    const at = new Date('2026-09-08T11:00:00Z');
    expect(ladderCheck(true, at)).toEqual({ ok: true, detail: `enabled, last match ${at.toISOString()}` });
  });
});

describe('the top-level ok', () => {
  it('is false as soon as any one check is', () => {
    const good = { db: { ok: true, detail: '1ms' }, backup: backupCheck({ name: 'x', mtimeMs: NOW }, NOW) };
    expect(ok(good)).toBe(true);
    expect(ok({ ...good, backup: backupCheck(null, NOW) })).toBe(false);
  });
});
