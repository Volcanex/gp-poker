import { useRef } from 'react';
import { useGInit } from './bits.tsx';

/* The address of a challenge, ready to be sent to somebody, with g's copy
   button beside it.

   Its own component because g-ui wires a `.copy-btn` once, on the element it
   is handed, and only if that element is already in the DOM. The row appears
   the moment a link exists, so the row is what has to mount: a ref on the
   card around it would be initialised while the button was still absent.

   The input is read-only rather than a `code` block so that selecting the
   whole thing by hand still works on a phone, where the copy button is the
   normal path but not the only one. */
export function ShareLink({ url }: { url: string }) {
  const row = useRef<HTMLDivElement>(null);
  useGInit(row);

  return (
    <div ref={row} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
      <input
        className="input"
        readOnly
        value={url}
        aria-label="Your challenge link"
        style={{ flex: 1, minWidth: 0 }}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        type="button"
        className="btn btn-secondary copy-btn"
        data-copy={url}
        aria-label="Copy the challenge link"
      >
        <span className="copy-label">Copy link</span>
      </button>
    </div>
  );
}
