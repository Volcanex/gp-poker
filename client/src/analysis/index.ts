/* The main thread's side of the analysis worker: one request, one promise, and
   a cancel by request id for the common case of a player acting before the
   previous answer arrives.

   The worker is created on first use, so importing this module costs nothing
   until something is actually analysed, and a browser without workers (or a
   jsdom test) simply gets a rejected promise instead of a broken page. */

import type { EquityResult, Range } from '@opentable/equity';
import type { Card, HandNaming, OutsRead, Request, Response, ShowdownRead } from './protocol.ts';

export type { Card, HandNaming, OutsRead, ShowdownHand, ShowdownRead } from './protocol.ts';
export type Villain = Range | 'random';

export class Cancelled extends Error {
  constructor(id: string) {
    super(`analysis ${id} was cancelled`);
    this.name = 'Cancelled';
  }
}

export function isCancelled(err: unknown): boolean {
  return err instanceof Cancelled;
}

let seq = 0;
export function nextRequestId(prefix = 'a'): string {
  seq += 1;
  return `${prefix}${seq}`;
}

interface Pending {
  resolve: (value: never) => void;
  reject: (err: Error) => void;
}

const pending = new Map<string, Pending>();
let worker: Worker | null = null;

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent) => {
    const message = event.data as Response;
    const waiting = pending.get(message.id);
    if (!waiting) return; // cancelled while it was already running
    pending.delete(message.id);
    if (message.ok) waiting.resolve(message.result as never);
    else waiting.reject(new Error(message.error));
  };
  worker.onerror = (event) => {
    const failure = new Error(event.message || 'the analysis worker stopped');
    for (const [, waiting] of pending) waiting.reject(failure);
    pending.clear();
    worker = null;
  };
  return worker;
}

function send<T>(request: Request): Promise<T> {
  if (typeof Worker === 'undefined') {
    return Promise.reject(new Error('this browser has no web workers, so hands cannot be analysed'));
  }
  const w = ensureWorker();
  return new Promise<T>((resolve, reject) => {
    pending.set(request.id, { resolve: resolve as (value: never) => void, reject });
    w.postMessage(request);
  });
}

export interface AnalyseInput {
  hero: Card[];
  board: Card[];
  villains: Villain[];
  samples?: number;
  id?: string;
}

export function analyse(input: AnalyseInput): Promise<EquityResult> {
  const { id = nextRequestId('e'), hero, board, villains, samples } = input;
  return send<EquityResult>({ id, kind: 'equity', hero, board, villains, samples });
}

export interface OutsInput {
  hero: [Card, Card];
  board: Card[];
  id?: string;
}

export function analyseOuts(input: OutsInput): Promise<OutsRead> {
  const { id = nextRequestId('o'), hero, board } = input;
  return send<OutsRead>({ id, kind: 'outs', hero, board });
}

export interface NameInput {
  cards: Card[];
  id?: string;
}

/* Names the best five of five to seven cards. Cheap, but it needs the same
   evaluator, so it goes through the worker like everything else. */
export function analyseName(input: NameInput): Promise<HandNaming> {
  const { id = nextRequestId('n'), cards } = input;
  return send<HandNaming>({ id, kind: 'name', cards });
}

export interface ShowdownInput {
  board: Card[];
  hands: Card[][];
  id?: string;
}

/* Who wins a finished board. The comparison belongs with the evaluator, so the
   worker returns the winners as well as the names. */
export function analyseShowdown(input: ShowdownInput): Promise<ShowdownRead> {
  const { id = nextRequestId('s'), board, hands } = input;
  return send<ShowdownRead>({ id, kind: 'showdown', board, hands });
}

/* Drops the answer on the floor and, if the job has not started yet, stops it
   from running at all. The promise rejects with Cancelled, which isCancelled
   exists to wave through. */
export function cancel(id: string): void {
  const waiting = pending.get(id);
  if (!waiting) return;
  pending.delete(id);
  waiting.reject(new Cancelled(id));
  worker?.postMessage({ kind: 'cancel', id });
}
