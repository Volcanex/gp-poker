/* The analysis worker. Everything expensive happens here and nowhere else:
   @opentable/equity pulls in phe, whose lookup tables are half a megabyte, and
   an exact turn enumeration is ninety thousand evaluations. Neither belongs on
   the thread that is painting cards, so the main thread never imports the
   package: it talks to this file and this file alone.

   Jobs run one at a time off a queue, with a yield between them, so a cancel
   for a job that has not started yet still lands. A job already running cannot
   be preempted, which is why the sampled paths are sized in tens of thousands
   of deals rather than millions. */

import { equity, handName } from '@opentable/equity';
import { readOuts } from './draw-outs.ts';
import type { Request, Response } from './protocol.ts';

const queue: Request[] = [];
let draining = false;

function reply(message: Response): void {
  (self as unknown as Worker).postMessage(message);
}

function run(job: Request): void {
  try {
    if (job.kind === 'equity') {
      reply({ id: job.id, ok: true, kind: 'equity', result: equity(job.hero, job.board, job.villains, { samples: job.samples }) });
    } else if (job.kind === 'outs') {
      reply({ id: job.id, ok: true, kind: 'outs', result: readOuts(job.hero, job.board) });
    } else {
      reply({ id: job.id, ok: true, kind: 'name', result: handName(job.cards) });
    }
  } catch (err) {
    reply({ id: job.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

function drain(): void {
  const job = queue.shift();
  if (!job) {
    draining = false;
    return;
  }
  run(job);
  setTimeout(drain, 0);
}

self.onmessage = (event: MessageEvent) => {
  const message = event.data as Request | { kind: 'cancel'; id: string };
  if (message.kind === 'cancel') {
    const at = queue.findIndex((job) => job.id === message.id);
    if (at >= 0) queue.splice(at, 1);
    return;
  }
  queue.push(message);
  if (!draining) {
    draining = true;
    setTimeout(drain, 0);
  }
};
