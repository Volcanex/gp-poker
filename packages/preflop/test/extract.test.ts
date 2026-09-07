import { describe, it, expect } from 'vitest';
import { extractDecisions } from '../src/extract.js';
import type { LoggedAction } from '@opentable/protocol';

const deepConfig = { seats: [{ stack: 200 }, { stack: 200 }], button: 0, bb: 2 };
const pushConfig = { seats: [{ stack: 16 }, { stack: 16 }], button: 0, bb: 2 };

describe('extractDecisions', () => {
  it('open-fold: one decision each side', () => {
    const actions: LoggedAction[] = [
      { s: 0, a: 'r', v: 6, t: 0 },
      { s: 1, a: 'f', t: 100 },
    ];
    const holes = { 0: ['Ah', 'Kh'] as [string, string], 1: ['7c', '2d'] as [string, string] };
    const decisions = extractDecisions(deepConfig, actions, holes);
    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toMatchObject({ seat: 0, spot: 'sb_open', bucket: 'deep', hand: 'AKs', action: 'aggr' });
    expect(decisions[1]).toMatchObject({ seat: 1, spot: 'bb_vs_open', bucket: 'deep', hand: '72o', action: 'fold' });
  });

  it('open-call: bb calls the open, no further decisions', () => {
    const actions: LoggedAction[] = [
      { s: 0, a: 'r', v: 6, t: 0 },
      { s: 1, a: 'c', t: 100 },
    ];
    const holes = { 0: ['Ah', 'Kh'] as [string, string], 1: ['Th', '9h'] as [string, string] };
    const decisions = extractDecisions(deepConfig, actions, holes);
    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toMatchObject({ seat: 0, spot: 'sb_open', action: 'aggr' });
    expect(decisions[1]).toMatchObject({ seat: 1, spot: 'bb_vs_open', hand: 'T9s', action: 'passive' });
  });

  it('open-3bet-call: three decisions, sb closes by calling the 3bet', () => {
    const actions: LoggedAction[] = [
      { s: 0, a: 'r', v: 6, t: 0 },
      { s: 1, a: 'r', v: 20, t: 100 },
      { s: 0, a: 'c', t: 200 },
    ];
    const holes = { 0: ['Jh', 'Th'] as [string, string], 1: ['Kd', 'Qc'] as [string, string] };
    const decisions = extractDecisions(deepConfig, actions, holes);
    expect(decisions).toHaveLength(3);
    expect(decisions.map((d) => d.spot)).toEqual(['sb_open', 'bb_vs_open', 'sb_vs_3bet']);
    expect(decisions.map((d) => d.action)).toEqual(['aggr', 'aggr', 'passive']);
    expect(decisions.map((d) => d.seat)).toEqual([0, 1, 0]);
  });

  it('open-3bet-4bet-fold: four decisions', () => {
    const actions: LoggedAction[] = [
      { s: 0, a: 'r', v: 6, t: 0 },
      { s: 1, a: 'r', v: 20, t: 100 },
      { s: 0, a: 'r', v: 60, t: 200 },
      { s: 1, a: 'f', t: 300 },
    ];
    const holes = { 0: ['Ah', 'Kh'] as [string, string], 1: ['Kd', 'Qc'] as [string, string] };
    const decisions = extractDecisions(deepConfig, actions, holes);
    expect(decisions).toHaveLength(4);
    expect(decisions.map((d) => d.spot)).toEqual(['sb_open', 'bb_vs_open', 'sb_vs_3bet', 'bb_vs_4bet']);
    expect(decisions.map((d) => d.action)).toEqual(['aggr', 'aggr', 'aggr', 'fold']);
    expect(decisions.map((d) => d.seat)).toEqual([0, 1, 0, 1]);
  });

  it('limp-check: only the limp is scored, the check behind it is not', () => {
    const actions: LoggedAction[] = [
      { s: 0, a: 'c', t: 0 },
      { s: 1, a: 'x', t: 100 },
    ];
    const holes = { 0: ['Th', '9h'] as [string, string], 1: ['Ah', 'Kh'] as [string, string] };
    const decisions = extractDecisions(deepConfig, actions, holes);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ seat: 0, spot: 'sb_open', hand: 'T9s', action: 'passive' });
  });

  it('short-stack jam: push bucket spots', () => {
    const actions: LoggedAction[] = [
      { s: 0, a: 'a', v: 16, t: 0 },
      { s: 1, a: 'c', t: 100 },
    ];
    const holes = { 0: ['Ah', 'Ac'] as [string, string], 1: ['Kd', 'Kc'] as [string, string] };
    const decisions = extractDecisions(pushConfig, actions, holes);
    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toMatchObject({ seat: 0, spot: 'sb_push', bucket: 'push', hand: 'AA', action: 'aggr' });
    expect(decisions[1]).toMatchObject({ seat: 1, spot: 'bb_vs_push', bucket: 'push', hand: 'KK', action: 'passive' });
    expect(decisions[0].inRange).toBe(true);
    expect(decisions[1].inRange).toBe(true);
  });

  it('stops at the first postflop action even given the full log', () => {
    const actions: LoggedAction[] = [
      { s: 0, a: 'r', v: 6, t: 0 },
      { s: 1, a: 'c', t: 100 },
      { s: 1, a: 'x', t: 200 },
      { s: 0, a: 'b', v: 10, t: 300 },
    ];
    const holes = { 0: ['Ah', 'Kh'] as [string, string], 1: ['Th', '9h'] as [string, string] };
    const decisions = extractDecisions(deepConfig, actions, holes);
    expect(decisions).toHaveLength(2);
  });
});
