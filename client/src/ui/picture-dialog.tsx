import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useGInit } from './bits.tsx';
import { useSession } from '../net/session.tsx';
import { api } from '../net/api.ts';
import './picture-dialog.css';

/* Choosing a profile picture. One dialog, opened from a button beside your own
   avatar on your profile and from the picture row in the settings menu.

   **The crop happens here, in a canvas, and the server never decodes an
   image.** A phone photo is four thousand pixels wide and eight megabytes; a
   seat at the table is twenty-eight. Shrinking it in the browser turns the
   upload into 120 KB over the wire and leaves the server with a magic-number
   check instead of a native image library, which on this box would mean a
   build dependency, a CVE feed and a rebuild on every Node upgrade in exchange
   for re-encoding something already the right size.

   What is sent is a 256 square, which is four times the largest place a
   picture is drawn (56) and so still sharp on a retina screen. */

const OUTPUT = 256;
const MAX_UPLOAD_BYTES = 120 * 1024;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const PREVIEW_SIZES = [56, 28, 24];
const STAGE = 224; // the crop square on screen, in CSS pixels
const ACCEPT = 'image/png,image/jpeg,image/webp';

/* Quality first, then size. A webp encoder that misses the budget at 0.85 is
   given three lower rungs before anything else changes. A browser with no webp
   encoder falls back to png, where quality is not a dial at all, so the ladder
   there is the square itself: 256, then 192, then 160. A picture drawn at 56
   still reads at 160. */
const WEBP_QUALITY = [0.85, 0.7, 0.55, 0.4];
const PNG_SIZES = [OUTPUT, 192, 160];

interface Source {
  draw: CanvasImageSource;
  w: number;
  h: number;
}

interface Crop {
  zoom: number; // 1 fits the short edge, 3 is a third of it
  cx: number; // centre of the crop, in source pixels
  cy: number;
}

export function PictureDialog({ ref }: { ref: RefObject<HTMLDialogElement | null> }) {
  const { me, refreshMe } = useSession();
  const stageRef = useRef<HTMLCanvasElement>(null);
  const previewRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  const [source, setSource] = useState<Source | null>(null);
  const [crop, setCrop] = useState<Crop>({ zoom: 1, cx: 0, cy: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hasPicture = (me?.avatarV ?? 0) > 0;

  const reset = useCallback(() => {
    setSource(null);
    setCrop({ zoom: 1, cx: 0, cy: 0 });
    setError(null);
    setBusy(false);
  }, []);

  const close = useCallback(() => {
    ref.current?.close();
  }, [ref]);

  /* Closing by any route (Escape, the backdrop, Cancel) puts the dialog back to
     where it opened, so the next open is not still holding a picture nobody
     chose to keep. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('close', reset);
    return () => el.removeEventListener('close', reset);
  }, [ref, reset]);

  const take = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_SOURCE_BYTES) {
      setError('That picture is over 8 MB. Choose a smaller one, or export it at a lower quality.');
      return;
    }
    setError(null);
    try {
      const loaded = await loadImage(file);
      setSource(loaded);
      setCrop({ zoom: 1, cx: loaded.w / 2, cy: loaded.h / 2 });
    } catch {
      setError('That file could not be opened as a picture. Png, jpeg and webp all work.');
    }
  }, []);

  /* One pass over the stage and the three previews on every change. They are
     the same crop at four sizes, so drawing them together is what keeps the
     little ones honest about what the big one is showing. */
  useEffect(() => {
    if (!source) return;
    drawCrop(stageRef.current, source, crop, STAGE);
    PREVIEW_SIZES.forEach((size, i) => drawCrop(previewRefs.current[i], source, crop, size));
  }, [source, crop]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!source) return;
    const canvas = e.currentTarget;
    canvas.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const from = crop;
    const side = shortSide(source) / from.zoom;

    const move = (ev: PointerEvent) => {
      const perPixel = side / STAGE;
      setCrop(clamp(source, {
        ...from,
        cx: from.cx - (ev.clientX - startX) * perPixel,
        cy: from.cy - (ev.clientY - startY) * perPixel,
      }));
    };
    const up = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  };

  /* The same reposition without a pointer. It stops the event rather than only
     preventing the default, because the arrow keys step a replay elsewhere in
     this app and a modal dialog's keydown still reaches the document. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!source) return;
    const step = (shortSide(source) / crop.zoom) / 16;
    const by = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!by) return;
    e.preventDefault();
    e.stopPropagation();
    setCrop(clamp(source, { ...crop, cx: crop.cx + by[0] * step, cy: crop.cy + by[1] * step }));
  };

  const upload = async () => {
    if (!source || busy) return;
    setBusy(true);
    setError(null);
    try {
      const picture = await encode(source, crop);
      if (!picture) {
        setError('This browser could not turn that into a picture. Try a different file.');
        setBusy(false);
        return;
      }
      await api.uploadAvatar(picture);
      await refreshMe();
      window.g?.toast({ title: 'Picture saved', kind: 'ok' });
      close();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.removeAvatar();
      await refreshMe();
      window.g?.toast({ title: 'Picture removed', kind: 'ok' });
      close();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <dialog className="dlg pic-dlg" ref={ref} aria-label="Profile picture">
      <div className="dlg-body">
        <span className="dlg-title">Profile picture</span>
        <span className="dlg-desc">
          The square you set here is cropped to a circle and shown beside your name, at the table and
          everywhere else.
        </span>

        {source ? (
          <CropEditor
            source={source}
            crop={crop}
            stageRef={stageRef}
            previewRefs={previewRefs}
            onCrop={(next) => setCrop(clamp(source, next))}
            onReset={reset}
            onPointerDown={onPointerDown}
            onKeyDown={onKeyDown}
          />
        ) : (
          <Dropzone onFile={take} />
        )}

        {error && <span className="error">{error}</span>}
      </div>

      <div className="dlg-foot">
        <button type="button" className="btn btn-tertiary" onClick={close}>
          Cancel
        </button>
        {hasPicture && (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={remove}>
            Remove picture
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={busy || !source} onClick={upload}>
          Upload picture
        </button>
      </div>
    </dialog>
  );
}

/* Two components rather than two branches of one, because g-ui appends a file
   list into the dropzone it wires and React knows nothing about that child: a
   branch swapping className on the same <div> left the chosen file's chip
   sitting above the crop. Different component types at the same position
   always remount, which takes g's DOM with it, and it is also what gives the
   crop editor a mount for `useGInit` to hang the slider off. */
function Dropzone({ onFile }: { onFile: (file: File | undefined) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useGInit(ref);

  /* g owns the input and announces a choice with a `files` event, so this
     listens for that rather than for the input's own change: a drop never
     fires one. */
  useEffect(() => {
    const zone = ref.current;
    if (!zone) return;
    const onFiles = (e: Event) => onFile((e as CustomEvent<{ files: File[] }>).detail?.files?.[0]);
    zone.addEventListener('files', onFiles);
    return () => zone.removeEventListener('files', onFiles);
  }, [onFile]);

  /* The ref is on a wrapper, not on the zone: g.init looks for its components
     **inside** the node it is handed and never at the node itself, so passing
     the .g-dropzone straight in wires nothing and the file input goes on
     firing a change event nobody listens to. */
  return (
    <div className="pic-drop" ref={ref}>
      <div className="g-dropzone">
        <div className="g-dropzone-prompt">
          <UploadIcon />
          <span className="g-dropzone-title">Drop a picture, or choose one</span>
          <span className="g-dropzone-hint">Png, jpeg or webp, up to 8 MB</span>
          <input type="file" accept={ACCEPT} aria-label="Picture file" />
        </div>
      </div>
    </div>
  );
}

function CropEditor({
  source, crop, stageRef, previewRefs, onCrop, onReset, onPointerDown, onKeyDown,
}: {
  source: Source;
  crop: Crop;
  stageRef: RefObject<HTMLCanvasElement | null>;
  previewRefs: RefObject<(HTMLCanvasElement | null)[]>;
  onCrop: (crop: Crop) => void;
  onReset: () => void;
  onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLCanvasElement>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useGInit(ref);

  return (
    <div className="pic-edit" ref={ref}>
      <canvas
        className="pic-stage"
        ref={stageRef}
        width={STAGE}
        height={STAGE}
        style={{ width: STAGE, height: STAGE }}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        tabIndex={0}
        aria-label="Move the picture with a drag or the arrow keys"
        role="img"
      />
      <div className="pic-side">
        <label className="pic-zoom">
          <span className="label">Zoom</span>
          <span className="g-slider">
            <input
              type="range"
              min={100}
              max={300}
              step={5}
              value={Math.round(crop.zoom * 100)}
              aria-label="Zoom"
              onChange={(e) => onCrop({ ...crop, zoom: Number(e.target.value) / 100 })}
            />
          </span>
        </label>
        <div className="pic-previews">
          {PREVIEW_SIZES.map((size, i) => (
            <span className="avatar" data-size={size} key={size}>
              <canvas
                ref={(el) => {
                  previewRefs.current[i] = el;
                }}
                width={size}
                height={size}
                aria-hidden="true"
              />
            </span>
          ))}
        </div>
        <span className="pic-hint">
          Drag the picture to move it, or use the arrow keys. These are the sizes it is drawn at.
        </span>
        <button type="button" className="btn btn-tertiary btn-sm" onClick={onReset}>
          Choose another
        </button>
      </div>
    </div>
  );
}

/* The profile's way in. The settings menu's row is in `settings.tsx` and owns
   its own ref, because **the dialog must not live inside the menu**: a popover
   is a scope as well as a box, and a `.g-slider` rendered under
   `.settings-menu` picks up the 108 px width that menu gives its volume
   control. A modal dialog is in the top layer either way, so nesting it there
   bought nothing and coupled it to a stylesheet it has no business reading.

   Each trigger owns a dialog rather than sharing one through a context: only
   your own profile shows both at once, and two closed dialogs in a document
   cost nothing next to a provider nobody else needs. */
export function EditPictureButton() {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => ref.current?.showModal()}
      >
        Edit picture
      </button>
      <PictureDialog ref={ref} />
    </>
  );
}

/* ------------------------------------------------------------------ crop */

function shortSide(source: Source): number {
  return Math.min(source.w, source.h);
}

/* Keeps the crop square inside the picture, so there is never a band of empty
   canvas down one edge however far it is dragged. */
function clamp(source: Source, crop: Crop): Crop {
  const zoom = Math.min(3, Math.max(1, crop.zoom));
  const side = shortSide(source) / zoom;
  const half = side / 2;
  return {
    zoom,
    cx: Math.min(source.w - half, Math.max(half, crop.cx)),
    cy: Math.min(source.h - half, Math.max(half, crop.cy)),
  };
}

function drawCrop(canvas: HTMLCanvasElement | null, source: Source, crop: Crop, size: number): void {
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  const side = shortSide(source) / crop.zoom;
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(source.draw, crop.cx - side / 2, crop.cy - side / 2, side, side, 0, 0, size, size);
}

/* EXIF orientation is the reason for createImageBitmap: a phone photo drawn
   through an <img> is rotated by the browser and drawn through a canvas is not,
   so a portrait taken sideways would upload sideways. The fallback path is for
   a browser without it, where the <img> is at least oriented correctly. */
async function loadImage(file: File): Promise<Source> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { draw: bitmap, w: bitmap.width, h: bitmap.height };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('not an image'));
      el.src = url;
    });
    return { draw: img, w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* The finished square, under the budget. Webp first at four qualities, then png
   at three sizes, and null only if a browser can encode neither. Every rung is
   measured rather than assumed: an encoder's answer for one photograph is not
   its answer for another. */
async function encode(source: Source, crop: Crop): Promise<Blob | null> {
  for (const quality of WEBP_QUALITY) {
    const blob = await toBlob(source, crop, OUTPUT, 'image/webp', quality);
    if (!blob || blob.type !== 'image/webp') break; // no webp encoder here
    if (blob.size <= MAX_UPLOAD_BYTES) return blob;
  }
  for (const size of PNG_SIZES) {
    const blob = await toBlob(source, crop, size, 'image/png');
    if (blob && blob.type === 'image/png' && blob.size <= MAX_UPLOAD_BYTES) return blob;
  }
  return null;
}

function toBlob(
  source: Source,
  crop: Crop,
  size: number,
  type: string,
  quality?: number
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  drawCrop(canvas, source, crop, size);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/* Phosphor's upload icon, the one g's own dropzone card uses. */
function UploadIcon() {
  return (
    <svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M224,152v56a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V152a8,8,0,0,1,16,0v56H208V152a8,8,0,0,1,16,0ZM93.66,85.66,120,59.31V152a8,8,0,0,0,16,0V59.31l26.34,26.35a8,8,0,0,0,11.32-11.32l-40-40a8,8,0,0,0-11.32,0l-40,40A8,8,0,0,0,93.66,85.66Z" />
    </svg>
  );
}
