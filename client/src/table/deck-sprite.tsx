/* The shapes every v2 card and chip is drawn from, once per document. Four
   suit pips as paths, so a heart is the same heart on every phone rather than
   whatever glyph the platform font has for U+2665; the back's hatch; and the
   chip, drawn from a low three-quarter view, which is the one angle at which a
   disc reads as a chip. Cards and chips reference these with <use>, so the
   whole deck is four paths and a pattern, not fifty three files.

   Every colour is a CSS variable read at the point of use: the pips take
   currentColor from the card, the chip reads its body and rim from the stack
   that draws it. Nothing here names a colour. */

/* Where the rim stripes sit on the chip: the side band runs between two
   ellipses fourteen units apart, so a stripe at x spans the band at that x. */
const CHIP_RX = 48;
const CHIP_RY = 26;
const CHIP_CY = 30;
const RIM = 14;
const STRIPES = [16, 38, 62, 84];

function rimStripe(x: number) {
  const s = Math.sqrt(Math.max(0, 1 - ((x - 50) / CHIP_RX) ** 2));
  const y = CHIP_CY + CHIP_RY * s;
  return <rect key={x} x={x - 3} y={y - 1} width="6" height={RIM + 1} fill="var(--_mark)" />;
}

/* Six marks around the face, matching the edge stripes, the way a real chip's
   edge spots wrap over onto its face. */
const FACE_MARKS = [0, 60, 120, 180, 240, 300].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return { x: 50 + 41 * Math.cos(a), y: CHIP_CY + 22 * Math.sin(a) };
});

export function DeckSprite() {
  return (
    <svg className="deck-sprite" aria-hidden="true" focusable="false" width="0" height="0">
      <defs>
        <symbol id="pip-s" viewBox="0 0 100 100">
          <path d="M50 6 C50 6 12 40 12 60 C12 74 23 83 34 83 C41 83 46 80 49 75 C47 85 42 91 34 95 L66 95 C58 91 53 85 51 75 C54 80 59 83 66 83 C77 83 88 74 88 60 C88 40 50 6 50 6 Z" />
        </symbol>
        <symbol id="pip-h" viewBox="0 0 100 100">
          <path d="M50 93 C50 93 9 62 9 36 C9 22 19 11 32 11 C40 11 46 15 50 23 C54 15 60 11 68 11 C81 11 91 22 91 36 C91 62 50 93 50 93 Z" />
        </symbol>
        <symbol id="pip-d" viewBox="0 0 100 100">
          <path d="M50 5 C60 23 74 39 91 50 C74 61 60 77 50 95 C40 77 26 61 9 50 C26 39 40 23 50 5 Z" />
        </symbol>
        <symbol id="pip-c" viewBox="0 0 100 100">
          <path d="M50 7 C38 7 29 16 29 27 C29 32 31 36 34 40 C31 39 28 38 26 38 C15 38 7 46 7 57 C7 68 15 76 26 76 C33 76 39 72 43 66 C42 76 38 86 32 95 L68 95 C62 86 58 76 57 66 C61 72 67 76 74 76 C85 76 93 68 93 57 C93 46 85 38 74 38 C72 38 69 39 66 40 C69 36 71 32 71 27 C71 16 62 7 50 7 Z" />
        </symbol>

        <pattern id="back-hatch" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" stroke="var(--card-back-line)" strokeWidth="1.6" />
        </pattern>

        <symbol id="chip" viewBox="0 0 100 72">
          <path
            d={`M2 ${CHIP_CY} A${CHIP_RX} ${CHIP_RY} 0 0 0 98 ${CHIP_CY} L98 ${CHIP_CY + RIM} A${CHIP_RX} ${CHIP_RY} 0 0 1 2 ${CHIP_CY + RIM} Z`}
            fill="var(--_rim)"
          />
          {STRIPES.map(rimStripe)}
          <ellipse cx="50" cy={CHIP_CY} rx={CHIP_RX} ry={CHIP_RY} fill="var(--_body)" />
          <ellipse cx="50" cy={CHIP_CY} rx="33" ry="17.5" fill="none" stroke="var(--_mark)" strokeWidth="2.5" />
          {FACE_MARKS.map((m) => (
            <circle key={`${m.x}`} cx={m.x} cy={m.y} r="2.8" fill="var(--_mark)" />
          ))}
          <ellipse
            cx="50" cy={CHIP_CY} rx={CHIP_RX} ry={CHIP_RY}
            fill="none" stroke="var(--_edge)" strokeWidth="1" vectorEffect="non-scaling-stroke"
          />
        </symbol>
      </defs>
    </svg>
  );
}
