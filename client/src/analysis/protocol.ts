/* What crosses the worker boundary. A Range is a Set of hand class strings and
   structured clone carries a Set as it is, so ranges go over unchanged. */

import type { EquityResult, HandCategory, Range } from '@opentable/equity';
import type { OutsRead } from './draw-outs.ts';

export type Card = string;

export interface EquityRequest {
  id: string;
  kind: 'equity';
  hero: Card[];
  board: Card[];
  villains: (Range | 'random')[];
  samples?: number;
}

export interface OutsRequest {
  id: string;
  kind: 'outs';
  hero: [Card, Card];
  board: Card[];
}

export interface NameRequest {
  id: string;
  kind: 'name';
  cards: Card[];
}

export type Request = EquityRequest | OutsRequest | NameRequest;

export type { OutsRead } from './draw-outs.ts';

export interface HandNaming {
  category: HandCategory;
  name: string;
}

export type Response =
  | { id: string; ok: true; kind: 'equity'; result: EquityResult }
  | { id: string; ok: true; kind: 'outs'; result: OutsRead }
  | { id: string; ok: true; kind: 'name'; result: HandNaming }
  | { id: string; ok: false; error: string };
