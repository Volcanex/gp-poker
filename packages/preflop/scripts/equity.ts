/* Regenerates data/equity.json: each of the 169 hand classes' all-in equity
   heads-up against a uniformly random opponent hand, by Monte Carlo with a
   seeded PRNG (mulberry32) so the output is reproducible. Suit identity
   never affects equity (only whether a class is suited or offsuit), so each
   class is represented by one fixed concrete combo.

   Run: npx tsx packages/preflop/scripts/equity.ts
   Commit the resulting data/equity.json alongside this script; runtime code
   never recomputes equity. */

import { evaluateCards } from 'phe';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { allHandClasses, RANKS } from '../src/hand.js';

const SUITS = ['h', 'd', 'c', 's'];
const TRIALS_PER_CLASS = 40_000;
const SEED = 0xc0ffee;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fullDeck(): string[] {
  const deck: string[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
}

function representative(cls: string): [string, string] {
  if (cls.length === 2) return [`${cls[0]}h`, `${cls[0]}d`];
  const suited = cls[2] === 's';
  return [`${cls[0]}h`, `${cls[1]}${suited ? 'h' : 'd'}`];
}

// Truncated Fisher-Yates: shuffles only the first `count` slots, which is
// all a trial needs (2 villain cards + 5 board cards), reused across trials
// on the same backing array.
function partialShuffle(deck: string[], count: number, rng: () => number): void {
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (deck.length - i));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
}

function equityFor(cls: string, rng: () => number): number {
  const hero = representative(cls);
  const rest = fullDeck().filter((c) => c !== hero[0] && c !== hero[1]);
  let wins = 0;
  let ties = 0;
  for (let t = 0; t < TRIALS_PER_CLASS; t++) {
    partialShuffle(rest, 7, rng);
    const villain = [rest[0], rest[1]];
    const board = rest.slice(2, 7);
    const heroRank = evaluateCards([...hero, ...board]);
    const villRank = evaluateCards([...villain, ...board]);
    if (heroRank < villRank) wins++;
    else if (heroRank === villRank) ties++;
  }
  return (wins + ties * 0.5) / TRIALS_PER_CLASS;
}

function main(): void {
  const rng = mulberry32(SEED);
  const classes = allHandClasses();
  const results: Record<string, number> = {};
  const start = Date.now();

  for (const cls of classes) {
    results[cls] = Math.round(equityFor(cls, rng) * 1e5) / 1e5;
  }

  // An array of [class, equity] tuples, not an object: plain JS objects
  // reorder integer-like keys ('22', '33', ...) to the front regardless of
  // insertion order, which would silently break the descending sort below.
  const sorted = Object.entries(results).sort((a, b) => b[1] - a[1]);
  const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'equity.json');
  const lines = sorted.map(([cls, eq]) => `  ${JSON.stringify([cls, eq])}`).join(',\n');
  writeFileSync(outPath, `[\n${lines}\n]\n`);

  const ms = Date.now() - start;
  console.log(`wrote ${classes.length} classes x ${TRIALS_PER_CLASS} trials in ${ms}ms -> ${outPath}`);
}

main();
