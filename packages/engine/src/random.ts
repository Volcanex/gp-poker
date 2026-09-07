/* Deterministic, provably-fair shuffle. The deck for a hand is fully
   determined by its seed: same seed always yields the same 52-card order. */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { Card } from '@opentable/protocol';

const RANKS = '23456789TJQKA';
const SUITS = ['c', 'd', 'h', 's'] as const;

export function newSeed(): string {
  return randomBytes(32).toString('hex');
}

export function seedHash(seed: string): string {
  return createHash('sha256').update(Buffer.from(seed, 'hex')).digest('hex');
}

/* HMAC-SHA256 counter DRBG: block i = HMAC(seed, be32(i)). Bytes are consumed
   in order, refilling with the next block once exhausted. */
function makeByteStream(seed: string): () => number {
  const key = Buffer.from(seed, 'hex');
  let counter = 0;
  let block = Buffer.alloc(0);
  let pos = 0;
  function refill(): void {
    const ctr = Buffer.alloc(4);
    ctr.writeUInt32BE(counter, 0);
    counter += 1;
    block = createHmac('sha256', key).update(ctr).digest();
    pos = 0;
  }
  return function nextByte(): number {
    if (pos >= block.length) refill();
    return block[pos++];
  };
}

/* Unbiased integer in [0, range) via rejection sampling over the byte stream. */
function makeRandomInt(nextByte: () => number): (range: number) => number {
  return function randomInt(range: number): number {
    const bits = Math.max(1, Math.ceil(Math.log2(range)));
    const bytes = Math.ceil(bits / 8);
    const mask = (1 << bits) - 1;
    for (;;) {
      let value = 0;
      for (let i = 0; i < bytes; i++) value = (value << 8) | nextByte();
      value &= mask;
      if (value < range) return value;
    }
  };
}

export function deckFromSeed(seed: string): Card[] {
  const randomInt = makeRandomInt(makeByteStream(seed));
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck;
}
