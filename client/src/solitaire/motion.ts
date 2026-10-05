/* How a solitaire card gets from one place to another. Everything here moves
   by transform and nothing fades: a card is always somewhere, so it glides,
   turns over or shakes where it lies, and never appears out of nothing. The
   board renders every one of the 52 cards, face up or down, so any change of
   state can be shown as each card travelling from its old box to its new
   one (FLIP: measure first, render, measure last, invert, play). */

export const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
export const GLIDE_MS = 210;
export const TURN_MS = 260;

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/* Every card's box on screen, by card. Taken just before a state change, it
   includes whatever animation or drag is in flight, which is what lets a
   second move start from where the card visibly is rather than where it was
   headed. */
export function measure(root: HTMLElement): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>();
  root.querySelectorAll<HTMLElement>('[data-card]').forEach((el) => rects.set(el.dataset.card!, el.getBoundingClientRect()));
  return rects;
}

export function stopAll(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-card]').forEach((el) => {
    el.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  });
}

const centre = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/* Glides a card from a box it used to occupy to the one it occupies now. The
   card is raised for the flight so it passes over the piles it crosses, and
   lowered again the moment it lands. Returns when it lands, in ms from now. */
export function glide(el: HTMLElement, from: DOMRect, opts: { delay?: number; duration?: number; scale?: number; z?: number } = {}): number {
  const { delay = 0, duration = GLIDE_MS, scale = 1, z = 100 } = opts;
  const to = el.getBoundingClientRect();
  const a = centre(from);
  const b = centre(to);
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const s = scale * (to.width ? from.width / to.width : 1);
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(s - 1) < 0.01) return 0;
  const anim = el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, zIndex: z },
      { transform: 'none', zIndex: z },
    ],
    { duration, delay, easing: EASE, fill: 'backwards' },
  );
  void anim;
  return delay + duration;
}

/* The only perspective a card needs is its own, so it is part of the
   keyframe and no ancestor carries a 3D context while nothing is turning. */
const turned = new WeakMap<HTMLElement, Animation>();
export function turn(el: HTMLElement, toDown: boolean, delay = 0, duration = TURN_MS): number {
  const face = el.querySelector<HTMLElement>('.sol-face');
  if (!face) return 0;
  const depth = Math.max(400, el.getBoundingClientRect().width * 5);
  const up = `perspective(${depth}px) rotateY(0deg)`;
  const down = `perspective(${depth}px) rotateY(180deg)`;
  el.dataset.turning = '';
  const anim = face.animate(
    toDown ? [{ transform: up }, { transform: down }] : [{ transform: down }, { transform: up }],
    { duration, delay, easing: 'cubic-bezier(0.3, 0, 0.1, 1)', fill: 'backwards' },
  );
  turned.set(el, anim);
  const done = () => { if (turned.get(el) === anim) { delete el.dataset.turning; turned.delete(el); } };
  anim.onfinish = done;
  anim.oncancel = done;
  return delay + duration;
}

/* A short no: the card shakes its head on the spot. Uses the separate
   translate property so it never fights a glide or a drag on transform. */
export function shake(els: HTMLElement[]) {
  for (const el of els) {
    el.animate(
      [{ translate: '0 0' }, { translate: '-6px 0' }, { translate: '5px 0' }, { translate: '-3px 0' }, { translate: '2px 0' }, { translate: '0 0' }],
      { duration: 300, easing: 'ease-out' },
    );
  }
}

/* A dropped card that has nowhere to go returns home with a little overshoot,
   the way a card does when it is pushed back. */
export function springBack(el: HTMLElement, dx: number, dy: number) {
  el.animate(
    [{ transform: `translate(${dx}px, ${dy}px)`, zIndex: 1000 }, { transform: 'none', zIndex: 1000 }],
    { duration: 340, easing: 'cubic-bezier(0.3, 1.3, 0.5, 1)' },
  );
}

/* How far two boxes overlap, in square pixels. A drop goes to the legal pile
   the held card covers most, which is how a card on a real table is placed. */
export function overlap(a: DOMRect, b: DOMRect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}
