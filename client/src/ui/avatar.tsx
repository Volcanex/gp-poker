import { avatarDataUri } from '@opentable/identity';

export interface AvatarProps {
  /* The user id, always: a name can be claimed and changed, and the picture
     must not change with it. The leaderboard and a profile's match history
     were the two payloads that carried names only; they carry ids now, and
     both callers go through avatarSeed() in src/net/adapt.ts, which falls
     back to the name for a client talking to a server that predates them. */
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
