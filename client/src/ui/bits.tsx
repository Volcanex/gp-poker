import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { HandMeta, TableInfo } from './prefs.ts';

declare global {
  interface Window {
    g?: {
      init: (root?: ParentNode) => void;
      theme: (mode: 'dark' | 'light' | 'system') => void;
      toast: (o: {
        title: string;
        desc?: string;
        kind?: string;
        action?: { label: string; onClick?: () => void };
      }) => void;
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

/* A keyboard shortcut must not fire while someone is typing, but a checkbox or
   a button is not typing: arrow keys mean nothing to them, and swallowing the
   shortcut there only makes the page feel broken after a click. */
export function isTextEntry(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || !node.tagName) return false;
  const tag = node.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (node.isContentEditable) return true;
  if (tag !== 'INPUT') return false;
  const type = (node as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range'].includes(type);
}

/* A media query as a value. The hero band draws two different raise controls
   rather than one control at two sizes: a sweep under a thumb and a row of
   sizes under a mouse, each with its own meaning for the number keys. Which
   one exists has to be a render decision, not a CSS one, because both of them
   would answer the same keyboard. */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const read = () => setOn(mq.matches);
    read();
    mq.addEventListener('change', read);
    return () => mq.removeEventListener('change', read);
  }, [query]);
  return on;
}

/* An attribute `applyPrefs` (`./prefs.ts`) stamps on the root element, read
   live. Most of what that file writes is a pixel a stylesheet can carry
   alone and nothing here needs to know it changed; this is for the one kind
   of setting a component's own DOM shape depends on, where a stylesheet
   cannot make the choice by itself. A `MutationObserver` rather than the
   settings menu's own state, because the menu is not an ancestor of every
   reader: `SiteShell` mounts once for the app and a match is a route deep
   under it, so there is no prop this could arrive on. */
export function useRootAttr(name: string): string | null {
  const [v, setV] = useState<string | null>(
    () => (typeof document === 'undefined' ? null : document.documentElement.getAttribute(name)),
  );
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setV(root.getAttribute(name));
    read();
    const obs = new MutationObserver(read);
    obs.observe(root, { attributes: true, attributeFilter: [name] });
    return () => obs.disconnect();
  }, [name]);
  return v;
}

/* Panel is the default and the absent attribute, the way every setting in
   `./prefs.ts` works, so anything but `seat` reads as `panel`. */
export function useTableInfo(): TableInfo {
  return useRootAttr('data-table-info') === 'seat' ? 'seat' : 'panel';
}

/* The same bargain for the three settings a control outside the menu can move
   (`./prefs.ts`, `updatePrefs`): the default is the absent attribute, so
   anything that is not the other value reads as the default. */
export function useHandMeta(): HandMeta {
  return useRootAttr('data-hand-meta') === 'acts' ? 'acts' : 'cards';
}

export function useKeyLegend(): boolean {
  return useRootAttr('data-key-legend') !== 'off';
}

export function useGamePanelOpen(): boolean {
  return useRootAttr('data-game-panel') !== 'shut';
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

/* Up, down or flat: the one place a rating delta's colour is decided, so the
   profile and the result panel cannot drift apart. */
export function deltaTone(n: number): Record<string, string> {
  if (n > 0) return { 'data-up': '' };
  if (n < 0) return { 'data-down': '' };
  return { 'data-flat': '' };
}
