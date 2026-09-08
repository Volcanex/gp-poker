/* The pure half of profile pictures: what a picture may be, how big it may
   get, and how often one person may change theirs. The route in `routes.ts`
   does the database work; everything decidable without one lives here so it is
   testable without a table.

   **Nothing here decodes an image.** The client draws the crop on a canvas and
   exports a 256 square, so the server's job is to be sure the bytes it is
   about to hand back to a browser really are the format the browser will be
   told they are. That is a magic-number check, not a decode: a native image
   library on this box would be a build dependency, a CVE feed and a rebuild on
   every Node upgrade, in exchange for re-encoding something already the right
   size. */

export type AvatarType = 'image/webp' | 'image/png';

/* 128 KB is the hard limit the route sets on its own body. The client aims at
   120 KB and re-encodes at a lower quality until it fits, so the gap is the
   room a browser's encoder has to miss by and still be accepted rather than
   silently rejected after the player waited. */
export const AVATAR_MAX_BYTES = 128 * 1024;

/* One change per this long, per player. A picture is not a thing anybody needs
   to change twice in a breath, and the limit is what stops a script filling the
   users table with 128 KB writes. */
export const AVATAR_MIN_GAP_MS = 10_000;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/* What these bytes actually are, or null for anything else. PNG is an eight
   byte signature; WebP is a RIFF container, so it is 'RIFF', four bytes of
   length, then 'WEBP'. A GIF, a JPEG, an SVG or an HTML page pretending to be
   a picture all fall out here. */
export function sniffAvatar(bytes: Uint8Array): AvatarType | null {
  if (bytes.length >= 8 && PNG_MAGIC.every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let out = '';
  for (let i = from; i < to; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/* One entry per player who has changed a picture recently, dropped as soon as
   its gap has passed rather than kept for the life of the process: the map is
   swept on every allow, so it holds only the people mid-cooldown. */
export class AvatarLimiter {
  private last = new Map<string, number>();

  constructor(private gapMs = AVATAR_MIN_GAP_MS) {}

  allow(userId: string, now = Date.now()): boolean {
    for (const [id, at] of this.last) if (now - at >= this.gapMs) this.last.delete(id);
    const previous = this.last.get(userId);
    if (previous !== undefined && now - previous < this.gapMs) return false;
    this.last.set(userId, now);
    return true;
  }
}
