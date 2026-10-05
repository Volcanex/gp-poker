/* The win: the old desktop solitaire cascade. Cards leave the foundations
   kings first, one at a time, and bounce off the bottom of the screen,
   leaving a trail of themselves behind because the canvas is never cleared.
   Drawn on one canvas so a phone only composites a single layer however many
   cards are in the air. The card art is the table's own: the same paper,
   edge, rank and pip paths as `PlayingCard`, read off the page's tokens and
   the deck sprite, rasterised once per card. */

import type { Card } from '@opentable/protocol';

export interface Launch {
  card: Card;
  rect: DOMRect;
  el: HTMLElement;
}

interface Flying {
  image: HTMLCanvasElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
}

const GRAVITY = 2200; // px per second squared
const LAUNCH_MS = 240;

function cardArt(card: Card, w: number, dpr: number, style: CSSStyleDeclaration): HTMLCanvasElement {
  const h = w * 1.4;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * dpr);
  canvas.height = Math.ceil(h * dpr);
  const ctx = canvas.getContext('2d')!;
  const k = (w * dpr) / 100;
  ctx.scale(k, k);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  ctx.beginPath();
  const r = 8;
  ctx.moveTo(0.5 + r, 0.5);
  ctx.arcTo(99.5, 0.5, 99.5, 139.5, r);
  ctx.arcTo(99.5, 139.5, 0.5, 139.5, r);
  ctx.arcTo(0.5, 139.5, 0.5, 0.5, r);
  ctx.arcTo(0.5, 0.5, 99.5, 0.5, r);
  ctx.closePath();
  ctx.fillStyle = token('--card-face', '#fff');
  ctx.fill();
  ctx.lineWidth = 1 / k * dpr;
  ctx.strokeStyle = token('--card-edge', '#888');
  ctx.stroke();
  const suit = card[1];
  ctx.fillStyle = token(`--pip-${suit}`, suit === 'h' || suit === 'd' ? '#c33' : '#222');
  const ten = card[0] === 'T';
  ctx.font = `600 ${ten ? 38 : 46}px ${token('--font-ui', 'sans-serif')}`;
  ctx.fillText(ten ? '10' : card[0], 9, 47);
  const d = document.querySelector(`#pip-${suit} path`)?.getAttribute('d');
  if (d) {
    const pip = new Path2D(d);
    ctx.save(); ctx.translate(9, 55); ctx.scale(0.25, 0.25); ctx.fill(pip); ctx.restore();
    ctx.save(); ctx.translate(42, 76); ctx.scale(0.5, 0.5); ctx.fill(pip); ctx.restore();
  }
  return canvas;
}

/* Starts the cascade and returns the function that stops it. `launches` is
   in the order the cards leave; each one's element is hidden as it goes so
   the foundation shows the card beneath, and shown again on stop. */
export function cascade(canvas: HTMLCanvasElement, launches: Launch[], style: CSSStyleDeclaration, onLaunch?: (i: number) => void): () => void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const flying: Flying[] = [];
  const hidden: HTMLElement[] = [];
  let next = 0;
  let sinceLaunch = LAUNCH_MS;
  let last = performance.now();
  let frame = 0;

  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    sinceLaunch += dt * 1000;
    if (next < launches.length && sinceLaunch >= LAUNCH_MS) {
      sinceLaunch = 0;
      const { card, rect, el } = launches[next];
      el.style.visibility = 'hidden';
      hidden.push(el);
      const side = Math.random() < 0.5 ? -1 : 1;
      flying.push({
        image: cardArt(card, rect.width, dpr, style),
        x: rect.left, y: rect.top, w: rect.width, h: rect.height,
        vx: side * (160 + Math.random() * 260), vy: -(Math.random() * 520),
      });
      onLaunch?.(next);
      next++;
    }
    for (let i = flying.length - 1; i >= 0; i--) {
      const c = flying[i];
      c.vy += GRAVITY * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      if (c.y + c.h > H) {
        c.y = H - c.h;
        c.vy = -c.vy * 0.72;
      }
      ctx.drawImage(c.image, c.x, c.y, c.w, c.h);
      if (c.x + c.w < 0 || c.x > W) flying.splice(i, 1);
    }
    if (next < launches.length || flying.length) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    for (const el of hidden) el.style.visibility = '';
    ctx.clearRect(0, 0, W, H);
  };
}
