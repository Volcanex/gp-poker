import { countryName } from './countries.ts';

/* The flag a player put beside their own name.

   An image of a committed SVG, never an emoji flag: the regional indicator
   pairs render as two grey letters on Windows, which is most of the people
   who would ever see one. The artwork is `flag-icons`' 4x3 set, copied into
   public/flags by ../../scripts/flags.mjs.

   Sized in the aspect ratio the artwork is drawn at, so nothing is squashed,
   and given a hairline outline because a white flag on a light surface is
   otherwise an invisible box with a Swiss cross floating in it.

   It is not decorative: the country is a thing the player chose to say, and
   nothing else on the row says it, so the alt text is the country's name. */

export interface FlagProps {
  code: string; // lowercase ISO 3166-1 alpha-2
  /* Width in pixels. The height follows from the 4:3 artwork, rounded, so a
     row of flags at one size all share one box. */
  size?: number;
  className?: string;
}

export function flagHeight(size: number): number {
  return Math.round((size * 3) / 4);
}

export function Flag({ code, size = 16, className }: FlagProps) {
  const name = countryName(code);
  return (
    <img
      className={className ? `flag ${className}` : 'flag'}
      src={`/flags/${code}.svg`}
      width={size}
      height={flagHeight(size)}
      alt={name}
      title={name}
      loading="lazy"
      decoding="async"
    />
  );
}

/* The same box whether or not there is a flag in it. A marker that comes and
   goes moves everything after it, which is the rule the seat line and the
   phone band are both held to (../table/CLAUDE.md, "One footprint"), so the
   slot is always drawn and only the picture inside it is conditional. */
export function FlagSlot({ code, size = 16 }: { code?: string | null; size?: number }) {
  if (code) return <Flag code={code} size={size} />;
  return (
    <span
      className="flag flag-empty"
      style={{ width: size, height: flagHeight(size) }}
      aria-hidden="true"
    />
  );
}
