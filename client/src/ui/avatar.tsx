import { avatarDataUri } from '@opentable/identity';

export interface AvatarProps {
  /* The user id wherever the payload carries one. Two endpoints do not: the
     leaderboard and a profile's match history send names only, so those seed
     on the name and change if the name does. Swap them to the id the day the
     server sends one. */
  seed: string;
  name: string;
  size?: number;
}

/* g ships `.avatar`; only its size is adjusted, and through a data attribute
   rather than an inline custom property: an inline style beats every selector,
   so the ring's smaller seats could not shrink it. The
   picture is the identity package's deterministic geometric SVG, which is a
   rounded square cropped to g's circle. Every avatar in this app sits beside
   the name it belongs to, so it is decorative: announcing it would read the
   name twice. */
export function Avatar({ seed, name, size = 26 }: AvatarProps) {
  return (
    <span className="avatar" data-size={size} title={name} aria-hidden="true">
      <img src={avatarDataUri(seed, size)} width={size} height={size} alt="" />
    </span>
  );
}
