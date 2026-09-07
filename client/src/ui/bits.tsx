import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

declare global {
  interface Window {
    g?: {
      init: (root?: ParentNode) => void;
      theme: (mode: 'dark' | 'light' | 'system') => void;
      toast: (o: { title: string; desc?: string; kind?: string }) => void;
    };
  }
}

/* g-ui.js wires its behaviour layer over the DOM once at load. React mounts
   later, so any subtree holding a g behavioural component asks for a pass.
   Each component stamps itself, so a second pass is a no-op, and the guard
   here keeps a strict-mode double effect from double-binding .copy-btn. */
export function useGInit(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || el.dataset.gDone === '1') return;
    el.dataset.gDone = '1';
    window.g?.init(el);
  }, [ref]);
}

/* Keeps the last non-null value visible for `ms`, then hides it. Used for the
   last-action label, which should linger long enough to read and then leave. */
export function useFading<T>(value: T | null, key: string, ms = 2400): T | null {
  const [shown, setShown] = useState<T | null>(value);
  const lastKey = useRef(key);
  useEffect(() => {
    if (value == null) {
      setShown(null);
      return;
    }
    lastKey.current = key;
    setShown(value);
    const timer = setTimeout(() => setShown(null), ms);
    return () => clearTimeout(timer);
  }, [key, ms, value]);
  return shown;
}

export function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs]);
  return now;
}

export function elapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
