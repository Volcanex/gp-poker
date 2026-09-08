import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../net/api.ts';
import type { TicketTarget } from '../net/types.ts';
import './admin.css';

/* Annotation mode: point at what is wrong on the page it is wrong on, draw
   over it, say what it is, and it becomes a ticket with the context attached.

   The overlay covers the viewport and takes every pointer event, so the page
   underneath is a picture for as long as it is up. That is deliberate: the
   highlighter reads the element under the pointer with
   `document.elementsFromPoint`, which would otherwise be competing with the
   page's own hover and click handlers for the same gesture.

   Two tools, because they answer different questions. The highlighter answers
   "which element", and stores a selector, a box and the text in it, which is
   what a fix needs. The pen answers "what about it", which no selector can
   say. A ticket usually carries both. */

type Tool = 'highlight' | 'pen';

interface Point {
  x: number;
  y: number;
}

const STROKE_WIDTH = 3;

/* A path from the body down to the element, short enough to read and specific
   enough to find it again: an id ends the walk, classes narrow a tag, and
   nth-of-type only appears where the tag alone is ambiguous. */
export function selectorFor(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.body && node !== document.documentElement && parts.length < 6) {
    const tag = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`${tag}#${node.id}`);
      break;
    }
    const classes = Array.from(node.classList).slice(0, 2).map((c) => `.${c}`).join('');
    let part = `${tag}${classes}`;
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(' > ');
}

function targetFor(el: Element): TicketTarget {
  const r = el.getBoundingClientRect();
  return {
    selector: selectorFor(el),
    rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
    text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    label: el.getAttribute('aria-label'),
  };
}

function boxStyle(rect: TicketTarget['rect']) {
  return { left: rect.x - 2, top: rect.y - 2, width: rect.width + 4, height: rect.height + 4 };
}

export function Annotate({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const drawing = useRef(false);

  const [tool, setTool] = useState<Tool>('highlight');
  const [hovered, setHovered] = useState<TicketTarget | null>(null);
  const [targets, setTargets] = useState<TicketTarget[]>([]);
  const [strokeCount, setStrokeCount] = useState(0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* The page must not move under the overlay: every box stored here is in
     viewport coordinates, and a scroll would leave them pointing at the wrong
     thing the moment they were read back. */
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const prevRoot = root.style.overflow;
    const prevBody = body.style.overflow;
    root.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      root.style.overflow = prevRoot;
      body.style.overflow = prevBody;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* The canvas is sized in device pixels and scaled back, so a stroke on a
     retina screen is a stroke rather than a staircase. The accent is read off
     the root element because a canvas cannot resolve a custom property. */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    const styles = getComputedStyle(document.documentElement);
    ctx.strokeStyle = styles.getPropertyValue('--accent-fill').trim() || styles.getPropertyValue('--text-primary').trim();
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokes.current) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (const p of stroke.slice(1)) ctx.lineTo(p.x, p.y);
      if (stroke.length === 1) ctx.lineTo(stroke[0].x + 0.1, stroke[0].y);
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    redraw();
  }, [redraw]);

  const elementUnder = useCallback((x: number, y: number): Element | null => {
    const root = rootRef.current;
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      if (root && root.contains(el)) continue;
      if (el === document.body || el === document.documentElement) continue;
      return el;
    }
    return null;
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'pen') {
      drawing.current = true;
      strokes.current.push([{ x: e.clientX, y: e.clientY }]);
      setStrokeCount(strokes.current.length);
      redraw();
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (tool === 'pen') {
      if (!drawing.current) return;
      strokes.current[strokes.current.length - 1]?.push({ x: e.clientX, y: e.clientY });
      redraw();
      return;
    }
    const el = elementUnder(e.clientX, e.clientY);
    setHovered(el ? targetFor(el) : null);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (tool === 'pen') {
      drawing.current = false;
      return;
    }
    const el = elementUnder(e.clientX, e.clientY);
    if (!el) return;
    const target = targetFor(el);
    setTargets((prev) => (prev.some((t) => t.selector === target.selector) ? prev : [...prev, target]));
  };

  const undo = () => {
    strokes.current.pop();
    setStrokeCount(strokes.current.length);
    redraw();
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const canvas = canvasRef.current;
      const { id } = await api.createTicket({
        url: window.location.href,
        path: window.location.pathname,
        note: note.trim(),
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          dpr: window.devicePixelRatio || 1,
          theme: document.documentElement.getAttribute('data-theme') ?? 'dark',
        },
        targets,
        drawing: canvas && strokes.current.length > 0 ? canvas.toDataURL('image/png') : null,
        // Nothing in the client stamps a build, so this is honestly null
        // rather than a guess the ticket would carry as a fact.
        build: null,
      });
      window.dispatchEvent(new CustomEvent('ot:ticket-saved'));
      window.g?.toast({
        title: 'Ticket saved',
        kind: 'ok',
        action: { label: 'Open the ticket', onClick: () => nav(`/admin/tickets/${id}`) },
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const live = tool === 'highlight' ? hovered : null;

  return (
    <div className="anno" ref={rootRef} data-tool={tool} role="dialog" aria-label="Annotate this page">
      <canvas className="anno-canvas" ref={canvasRef} aria-hidden="true" />
      <div
        className="anno-hit"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        data-testid="anno-hit"
      />
      {targets.map((t) => (
        <div key={t.selector} className="anno-target" style={boxStyle(t.rect)} />
      ))}
      {live && (
        <div className="anno-outline" style={boxStyle(live.rect)}>
          {/* The tail of the selector is the element's own tag and classes,
              which is the name it goes by in the code that draws it. */}
          <span className="anno-tag">{live.selector.split(' > ').slice(-1)[0]}</span>
        </div>
      )}

      <div className="card anno-panel">
        <div className="anno-tools" role="radiogroup" aria-label="Tool">
          <button
            type="button"
            className={`btn btn-sm ${tool === 'highlight' ? 'btn-secondary' : 'btn-tertiary'}`}
            role="radio"
            aria-checked={tool === 'highlight'}
            onClick={() => setTool('highlight')}
          >
            Highlight
          </button>
          <button
            type="button"
            className={`btn btn-sm ${tool === 'pen' ? 'btn-secondary' : 'btn-tertiary'}`}
            role="radio"
            aria-checked={tool === 'pen'}
            onClick={() => setTool('pen')}
          >
            Draw
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-tertiary btn-sm" disabled={strokeCount === 0} onClick={undo}>
            Undo
          </button>
        </div>

        <textarea
          className="input"
          value={note}
          placeholder="What is wrong here"
          aria-label="What is wrong here"
          onChange={(e) => setNote(e.target.value)}
        />

        <span className="anno-count">
          {targets.length} {targets.length === 1 ? 'element' : 'elements'} highlighted, {strokeCount}{' '}
          {strokeCount === 1 ? 'stroke' : 'strokes'}
        </span>
        {error && <span className="anno-error">{error}</span>}

        <div className="anno-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={note.trim().length === 0 || saving}
            data-loading={saving ? '' : undefined}
            onClick={() => void save()}
          >
            {saving && <span className="spinner" aria-hidden="true" />}
            <span>Save ticket</span>
          </button>
          <button type="button" className="btn btn-tertiary btn-sm" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
