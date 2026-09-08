/* What crosses the worker boundary. A Range is a Set of hand class strings and
   structured clone carries a Set as it is, so ranges go over unchanged, and so
   does a known holding, which is a pair of cards in an array. */

import type { EquityResult, HandCategory, Villain } from '@opentable/equity';
import type { OutsRead } from './draw-outs.ts';

export type Card = string;

export interface EquityRequest {
  id: string;
  kind: 'equity';
  hero: Card[];
  board: Card[];
  villains: Villain[];
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

/* Who won a showdown, and what everybody had. One request rather than a name
   per hand, because the winner is a comparison and the comparison has to be
   made by the evaluator rather than by the page reading the names back. */
export interface ShowdownRequest {
  id: string;
  kind: 'showdown';
  board: Card[];
  hands: Card[][];
}

export type Request = EquityRequest | OutsRequest | NameRequest | ShowdownRequest;

export type { OutsRead } from './draw-outs.ts';

export interface HandNaming {
  category: HandCategory;
  name: string;
}

export interface ShowdownHand extends HandNaming {
  /* phe's score, low to high. Carried so a page can say how close two hands
     were without asking the worker a second question. */
  strength: number;
  five: Card[];
}

export interface ShowdownRead {
  hands: ShowdownHand[];
  winners: number[]; // indexes into hands; more than one is a split
}

export type Response =
  | { id: string; ok: true; kind: 'equity'; result: EquityResult }
  | { id: string; ok: true; kind: 'outs'; result: OutsRead }
  | { id: string; ok: true; kind: 'name'; result: HandNaming }
  | { id: string; ok: true; kind: 'showdown'; result: ShowdownRead }
  | { id: string; ok: false; error: string };
