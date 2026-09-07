import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';

const R = 11;
const C = 2 * Math.PI * R;

export interface TimerRingProps {
  deadline: number; // epoch ms, from the server clock
  totalMs: number;
  paused: boolean;
}

/* Bespoke: a countdown driven by a server deadline, not a local duration, so a
   reconnecting client lands on the right remaining time. Depletes smoothly on
   rAF; under reduced motion it steps once a second instead. */
export function TimerRing({ deadline, totalMs, paused }: TimerRingProps) {
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
  const frac = totalMs > 0 ? Math.max(0, Math.min(1, ms / totalMs)) : 0;
  const secs = Math.ceil(ms / 1000);
  const tone = ms <= 3000 ? 'danger' : ms <= 7000 ? 'warn' : undefined;

  return (
    <span className="ring-wrap" title={paused ? 'Clock held while the player reconnects' : undefined}>
      <svg
        className="ring"
        viewBox="0 0 26 26"
        data-tone={tone}
        data-paused={paused ? '' : undefined}
        role="timer"
        aria-label={paused ? 'Clock held' : `${secs} seconds left`}
      >
        <circle className="track" cx="13" cy="13" r={R} />
        <circle
          className="head"
          cx="13"
          cy="13"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
        />
      </svg>
      <span className="s" aria-hidden="true">{secs}</span>
    </span>
  );
}
