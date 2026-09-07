import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';

export interface TurnClockProps {
  deadline: number; // epoch ms, from the server clock
  totalMs: number;
  paused: boolean;
}

/* Bespoke: a countdown driven by a server deadline rather than a local
   duration, so a reconnecting client lands on the right remaining time. The
   ring this replaced was 20 px at the far edge of the seat and easy to miss;
   the acting seat now carries an accent border and this bar along its top
   edge, which is the width of the whole seat.

   Quiet by design: it depletes and says nothing, and the only colour change is
   in the last five seconds. */
function useLeft({ deadline, totalMs, paused }: TurnClockProps) {
  const reduced = useReducedMotion();
  const [left, setLeft] = useState(() => Math.max(0, deadline - Date.now()));
  const frozen = useRef(left);

  useEffect(() => {
    if (paused) return;
    let raf = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      const ms = Math.max(0, deadline - Date.now());
      frozen.current = ms;
      setLeft(ms);
      if (!reduced) raf = requestAnimationFrame(tick);
    };
    tick();
    if (reduced) timer = setInterval(tick, 250);
    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearInterval(timer);
    };
  }, [deadline, paused, reduced]);

  const ms = paused ? frozen.current : left;
  return {
    ms,
    frac: totalMs > 0 ? Math.max(0, Math.min(1, ms / totalMs)) : 0,
    secs: Math.ceil(ms / 1000),
    tone: ms <= 5000 ? 'low' : undefined,
  };
}

/* The bar along the acting seat's top edge. Two pixels, the seat's own width,
   and no text: the seconds are beside the last action where the eye already
   goes. */
export function TurnBar(props: TurnClockProps) {
  const { frac, tone } = useLeft(props);
  return (
    <span
      className="turn-bar"
      data-tone={tone}
      data-paused={props.paused ? '' : undefined}
      aria-hidden="true"
    >
      <i style={{ transform: `scaleX(${frac})` }} />
    </span>
  );
}

export function TurnSeconds(props: TurnClockProps) {
  const { secs, tone } = useLeft(props);
  return (
    <span
      className="turn-secs num"
      data-tone={tone}
      role="timer"
      aria-label={props.paused ? 'Clock held while the player reconnects' : `${secs} seconds left`}
    >
      {props.paused ? 'held' : `${secs} s`}
    </span>
  );
}
