import { useEffect, useRef } from 'react';
import type { TableView } from '@opentable/protocol';
import { sound } from '../sound/index.ts';
import type { SoundEvent } from '../sound/index.ts';

/* The table's noises, in one place, driven by the same view everything else on
   the screen is drawn from. Nothing here knows whether sound is on: the module
   returns immediately when it is off, and the packs are only fetched once
   something actually plays.

   Every effect keys on the hand and action sequence, which is what stops a
   re-render from replaying the last thing that happened. */

const ACT_SOUND: Record<string, SoundEvent> = {
  b: 'bet', r: 'bet', a: 'bet', c: 'call', x: 'check', f: 'fold',
};

const CLOCK_WARNING_MS = 5_000;

export function useTableSounds(view: TableView | null): void {
  const lastEvent = useRef<string | null>(null);
  const lastTurn = useRef<string | null>(null);
  const lastHandEnd = useRef<number | null>(null);
  const lastTick = useRef<string | null>(null);

  /* What just happened on the table. */
  useEffect(() => {
    if (!view?.last) return;
    const key = `${view.h}:${view.n}:${view.last.k}`;
    if (lastEvent.current === key) return;
    lastEvent.current = key;

    const e = view.last;
    if (e.k === 'newhand' || e.k === 'deal') void sound.play('deal');
    else if (e.k === 'street') void sound.play('cardPlace');
    else if (e.k === 'award') void sound.play('chipsCollect');
    else if (e.k === 'act' && e.a) {
      const name = ACT_SOUND[e.a];
      if (name) void sound.play(name);
    }
  }, [view]);

  /* Your turn, once per decision. */
  useEffect(() => {
    if (!view || view.legal == null || view.you == null) {
      if (!view?.legal) lastTurn.current = null;
      return;
    }
    const key = `${view.h}:${view.n}`;
    if (lastTurn.current === key) return;
    lastTurn.current = key;
    void sound.play('yourTurn');
  }, [view]);

  /* The count before the next street of an all-in run-out. The server sends
     each number rather than a deadline, so a tick is a number arriving and
     nothing here has a clock of its own to drift. */
  useEffect(() => {
    const run = view?.runout;
    if (!run) {
      lastTick.current = null;
      return;
    }
    const key = `${view!.h}:${run.next}:${run.in}`;
    if (lastTick.current === key) return;
    lastTick.current = key;
    void sound.play('tick');
  }, [view]);

  /* Five seconds left on your own clock, once. A timer rather than a poll,
     because the deadline is a fact the server already sent. */
  useEffect(() => {
    if (!view?.clock || view.you == null) return;
    if (view.clock.seat !== view.you || view.clock.paused) return;
    const left = view.clock.deadline - Date.now() - CLOCK_WARNING_MS;
    if (left <= 0) return;
    const timer = setTimeout(() => void sound.play('clockWarning'), left);
    return () => clearTimeout(timer);
  }, [view]);

  /* The hand is over and you were in it. A hand you folded out of is somebody
     else's result, and it does not get a noise. */
  useEffect(() => {
    if (!view || view.street !== 'done' || !view.result || view.you == null) return;
    if (lastHandEnd.current === view.h) return;
    const mine = view.seats.find((s) => s.i === view.you);
    if (!mine || mine.folded || mine.out) return;
    lastHandEnd.current = view.h;
    const won = view.result.awards.some((a) => a.seat === view.you);
    void sound.play(won ? 'handWon' : 'handLost');
  }, [view]);
}

/* The match is over. Called from the route rather than a hook, because the
   result arrives as a message, not as a view. */
export function playMatchEnd(won: boolean): void {
  void sound.play(won ? 'matchWon' : 'matchLost');
}

/* Every control in the dock. Kept here so the dock does not import the sound
   module for one line. */
export function playClick(): void {
  void sound.play('click');
}

/* One count of a countdown. The run-out's ticks come off the view above; this
   is for the hold before the next hand, which the client counts down itself,
   so it is played from `useCountdown` where that number changes. */
export function playTick(): void {
  void sound.play('tick');
}
