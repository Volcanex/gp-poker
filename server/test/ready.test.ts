import { afterEach, describe, expect, it } from 'vitest';
import {
  READY_COOLDOWN_MAX_MS,
  READY_COOLDOWN_MS,
  formatFor,
  readyCooldownMs,
  type ReadyFailure,
} from '@opentable/protocol';
import {
  chargeNoShow,
  checkFor,
  cooldownUntil,
  declineReady,
  openReadyCheck,
  pendingCount,
  resetReadyChecks,
  respondReady,
} from '../src/ready.js';

/* The ready check as a state machine, with nobody connected to it.

   Every message it sends goes through the hub, and the hub drops a send to a
   user with no socket, so a test can drive the whole thing with made-up ids
   and read the outcome off the two callbacks the caller hands it. That is the
   part worth testing: which way a check settles, who is charged for it and who
   is owed their place back. What the client draws from the messages is the
   e2e suite's question. */

const FORMAT = formatFor('six-max', true);

interface Ran {
  started: number;
  failed: string[][];
  kept: string[][];
  why: ReadyFailure[];
}

function open(id: string, humans: string[], windowMs?: number): Ran {
  const ran: Ran = { started: 0, failed: [], kept: [], why: [] };
  const opened = openReadyCheck({
    id,
    format: FORMAT,
    seats: 6,
    humans,
    ...(windowMs !== undefined ? { windowMs } : {}),
    start: async () => {
      ran.started += 1;
    },
    onCancel: (failed, kept, why) => {
      ran.failed.push(failed);
      ran.kept.push(kept);
      ran.why.push(why);
    },
  });
  expect(opened).toBe(true);
  return ran;
}

const settled = () => new Promise((r) => setTimeout(r, 30));

afterEach(() => resetReadyChecks());

describe('the ready check', () => {
  it('deals the table once everybody has accepted, and not before', async () => {
    const ran = open('t1', ['a', 'b', 'c']);
    expect(checkFor('a')).not.toBeNull();

    respondReady('a', true);
    respondReady('b', true);
    await settled();
    expect(ran.started).toBe(0);

    respondReady('c', true);
    await settled();
    expect(ran.started).toBe(1);
    expect(ran.failed).toEqual([]);
    // Everybody is let go the moment it settles, so nothing is holding a
    // player who is already being dealt into a table.
    expect(checkFor('a')).toBeNull();
    expect(pendingCount()).toBe(0);
  });

  it('ignores a second accept from the same person', async () => {
    const ran = open('t2', ['a', 'b']);
    respondReady('a', true);
    respondReady('a', true);
    respondReady('a', true);
    await settled();
    expect(ran.started).toBe(0);
    respondReady('b', true);
    await settled();
    expect(ran.started).toBe(1);
  });

  it('drops the table the moment one person declines', async () => {
    const ran = open('t3', ['a', 'b', 'c']);
    respondReady('a', true);
    respondReady('b', false);
    await settled();

    expect(ran.started).toBe(0);
    expect(ran.why).toEqual(['declined']);
    expect(ran.failed).toEqual([['b']]);
    // The person who had not answered yet is not at fault either: only the
    // decliner is, and everybody else is owed their place.
    expect(ran.kept[0].sort()).toEqual(['a', 'c']);
    expect(checkFor('c')).toBeNull();
  });

  it('treats an explicit cancel as a decline', async () => {
    const ran = open('t4', ['a', 'b']);
    expect(declineReady('a')).toBe(true);
    await settled();
    expect(ran.why).toEqual(['declined']);
    expect(ran.failed).toEqual([['a']]);
    // Nobody to decline for once it has settled.
    expect(declineReady('b')).toBe(false);
  });

  it('charges everybody who said nothing when the window runs out', async () => {
    const ran = open('t5', ['a', 'b', 'c'], 40);
    respondReady('a', true);
    await new Promise((r) => setTimeout(r, 90));

    expect(ran.started).toBe(0);
    expect(ran.why).toEqual(['timeout']);
    expect(ran.failed[0].sort()).toEqual(['b', 'c']);
    expect(ran.kept[0]).toEqual(['a']);
  });

  it('settles once, however many answers arrive after it', async () => {
    const ran = open('t6', ['a', 'b'], 40);
    await new Promise((r) => setTimeout(r, 90));
    respondReady('a', true);
    respondReady('b', true);
    await settled();
    expect(ran.started).toBe(0);
    expect(ran.why).toHaveLength(1);
  });

  it('refuses to open a check over somebody already in one', () => {
    open('t7', ['a', 'b']);
    const second = openReadyCheck({
      id: 't8',
      format: FORMAT,
      seats: 6,
      humans: ['b', 'c'],
      start: async () => {},
      onCancel: () => {},
    });
    expect(second).toBe(false);
    // And it did not half-open: c was never taken.
    expect(checkFor('c')).toBeNull();
  });

  it('refuses a check with nobody human in it', () => {
    const opened = openReadyCheck({
      id: 't9',
      format: FORMAT,
      seats: 6,
      humans: [],
      start: async () => {},
      onCancel: () => {},
    });
    expect(opened).toBe(false);
  });
});

describe('no-show cooldowns', () => {
  it('doubles for every no-show inside the hour, and caps', () => {
    expect(readyCooldownMs(0)).toBe(0);
    expect(readyCooldownMs(1)).toBe(READY_COOLDOWN_MS);
    expect(readyCooldownMs(2)).toBe(2 * READY_COOLDOWN_MS);
    expect(readyCooldownMs(3)).toBe(4 * READY_COOLDOWN_MS);
    expect(readyCooldownMs(20)).toBe(READY_COOLDOWN_MAX_MS);
  });

  it('escalates a repeat offender and forgets an old one', () => {
    const at = 1_000_000;
    expect(chargeNoShow('a', at) - at).toBe(READY_COOLDOWN_MS);
    expect(chargeNoShow('a', at + 1_000) - (at + 1_000)).toBe(2 * READY_COOLDOWN_MS);
    expect(chargeNoShow('a', at + 2_000) - (at + 2_000)).toBe(4 * READY_COOLDOWN_MS);

    // An hour later the record has aged out and the next one is a first one
    // again: this is a filter on people who have walked away, not a ledger.
    const later = at + 61 * 60_000;
    expect(chargeNoShow('a', later) - later).toBe(READY_COOLDOWN_MS);
  });

  it('keeps a cooldown to the player who earned it', () => {
    const at = 2_000_000;
    chargeNoShow('a', at);
    chargeNoShow('a', at);
    expect(chargeNoShow('b', at) - at).toBe(READY_COOLDOWN_MS);
  });

  it('reports the cooldown until it runs out and not after', () => {
    const at = 3_000_000;
    const until = chargeNoShow('a', at);
    expect(cooldownUntil('a', at)).toBe(until);
    expect(cooldownUntil('a', until - 1)).toBe(until);
    expect(cooldownUntil('a', until)).toBeNull();
    expect(cooldownUntil('b', at)).toBeNull();
  });
});
