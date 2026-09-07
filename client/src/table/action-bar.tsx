import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActionKind, LegalActions } from '@opentable/protocol';
import { useGInit } from '../ui/bits.tsx';
import { clamp, raisePresets } from './sizing.ts';

export interface ActionBarProps {
  legal: LegalActions;
  pot: number;
  myBet: number;
  disabled: boolean;
  onAct: (a: ActionKind, v?: number) => void;
}

export function ActionBar({ legal, pot, myBet, disabled, onAct }: ActionBarProps) {
  const { actions, call, min, max } = legal;
  const canRaise = actions.includes('b') || actions.includes('r') || actions.includes('a');
  const raiseKind: ActionKind = actions.includes('b') ? 'b' : 'r';
  const isBet = raiseKind === 'b';

  const [amount, setAmount] = useState(() => clamp(min, min, max));
  const rangeRef = useRef<HTMLInputElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useGInit(wrapRef);

  /* A fresh decision resets the size to the minimum: carrying the last slider
     position into a new spot is how people misclick a stack in. */
  useEffect(() => setAmount(clamp(min, min, max)), [min, max]);

  /* g owns the slider fill and its readout, and syncs them on the input event.
     Replaying that event after a programmatic change keeps one owner. React
     bails on a set to the same value, so this cannot loop. */
  useEffect(() => {
    const el = rangeRef.current;
    if (!el) return;
    if (el.value !== String(amount)) el.value = String(amount);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [amount]);

  const presets = useMemo(() => raisePresets(legal, pot, myBet), [legal, pot, myBet]);

  const sendRaise = () => {
    if (disabled) return;
    if (amount >= max && actions.includes('a')) onAct('a');
    else onAct(raiseKind, amount);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'f' && actions.includes('f')) { e.preventDefault(); onAct('f'); }
      else if (k === 'c') {
        if (actions.includes('x')) { e.preventDefault(); onAct('x'); }
        else if (actions.includes('c')) { e.preventDefault(); onAct('c'); }
      } else if (k === 'r' && canRaise) {
        e.preventDefault();
        numberRef.current?.focus();
        numberRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, canRaise, disabled, onAct]);

  const raiseLabel = amount >= max ? `All in ${max}` : isBet ? `Bet ${amount}` : `Raise to ${amount}`;

  return (
    <div className="actions" ref={wrapRef}>
     <div className="bar-in">
      {canRaise && max > min && (
        <>
          <div className="presets">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                className="btn btn-tertiary btn-sm num"
                disabled={disabled}
                onClick={() => setAmount(p.value)}
                aria-pressed={amount === p.value}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="sizing">
            <span className="g-slider" data-output>
              <input
                ref={rangeRef}
                type="range"
                min={min}
                max={max}
                step={1}
                value={amount}
                disabled={disabled}
                aria-label={isBet ? 'Bet size' : 'Raise to'}
                onChange={(e) => setAmount(clamp(Number(e.target.value), min, max))}
              />
            </span>
            <input
              ref={numberRef}
              className="input num"
              type="number"
              inputMode="numeric"
              min={min}
              max={max}
              value={amount}
              disabled={disabled}
              aria-label={isBet ? 'Bet amount' : 'Raise to amount'}
              onChange={(e) => setAmount(Number(e.target.value))}
              onBlur={(e) => setAmount(clamp(Number(e.target.value) || min, min, max))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); sendRaise(); } }}
            />
          </div>
        </>
      )}

      <div className="acts">
        {actions.includes('f') && (
          <button type="button" className="btn btn-tertiary" disabled={disabled} onClick={() => onAct('f')}>
            Fold
          </button>
        )}
        {actions.includes('x') && (
          <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => onAct('x')}>
            Check
          </button>
        )}
        {actions.includes('c') && (
          <button type="button" className="btn btn-secondary num" disabled={disabled} onClick={() => onAct('c')}>
            Call {call}
          </button>
        )}
        {canRaise && (
          <button type="button" className="btn btn-primary num" disabled={disabled} onClick={sendRaise}>
            {raiseLabel}
          </button>
        )}
      </div>

      <span className="act-hint">
        <span className="kbd">f</span> fold
        <span className="kbd">c</span> check or call
        <span className="kbd">r</span> size a raise
      </span>
     </div>
    </div>
  );
}
