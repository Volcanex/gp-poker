/* Deterministic, provably-fair shuffle. The deck for a hand is fully
   determined by its seed: same seed always yields the same 52-card order. */

import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import type { Card } from '@opentable/protocol';

const RANKS = '23456789TJQKA';
const SUITS = ['c', 'd', 'h', 's'] as const;

export function newSeed(): string {
  return bytesToHex(randomBytes(32));
}

export function seedHash(seed: string): string {
  return bytesToHex(sha256(hexToBytes(seed)));
}

/* HMAC-SHA256 counter DRBG: block i = HMAC(seed, be32(i)). Bytes are consumed
   in order, refilling with the next block once exhausted. */
function makeByteStream(seed: string): () => number {
  const key = hexToBytes(seed);
  let counter = 0;
  let block = new Uint8Array(0);
  let pos = 0;
  function refill(): void {
    const ctr = new Uint8Array(4);
    new DataView(ctr.buffer).setUint32(0, counter, false);
    counter += 1;
    block = hmac(sha256, key, ctr);
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
