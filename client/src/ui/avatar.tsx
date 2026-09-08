import { useEffect, useState } from 'react';
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
  /* Which version of an uploaded picture to draw, 0 for none. Read it off a
     payload through avatarVersion() in src/net/adapt.ts rather than passing a
     raw field: absent and zero have to mean the same thing here. */
  avatarV?: number;
}

/* g ships `.avatar`; only its size is adjusted, and through a data attribute
   rather than an inline custom property: an inline style beats every selector,
   so the ring's smaller seats could not shrink it. The
   picture is the identity package's deterministic geometric SVG, which is a
   rounded square cropped to g's circle. Every avatar in this app sits beside
   the name it belongs to, so it is decorative: announcing it would read the
   name twice.

   **An uploaded picture is drawn over the generated one, not instead of it.**
   The generated SVG is the element's background, so the moment before the
   upload has decoded looks like the avatar that was always there rather than
   like a hole, and an image that 404s (the picture was removed while this page
   was open) falls back to exactly the same thing through onError. That is the
   whole failure story: there is no loading state and no placeholder to design,
   because the fallback is already a picture of this person. */
export function Avatar({ seed, name, size = 26, avatarV = 0 }: AvatarProps) {
  const generated = avatarDataUri(seed, size);
  const [failed, setFailed] = useState(false);
  const src = avatarV > 0 && seed ? `/api/avatars/${encodeURIComponent(seed)}?v=${avatarV}` : null;
  const photo = src !== null && !failed;

  /* A new version is a new URL and deserves a fresh attempt: without this, a
     picture that 404'd once (removed, or uploaded from another tab) would stay
     hidden for the life of the component even after one exists again. */
  useEffect(() => setFailed(false), [src]);

  return (
    <span
      className="avatar"
      data-size={size}
      title={name}
      aria-hidden="true"
      /* Only under a picture, so the common case does not hold the same data
         URI twice for every avatar on a leaderboard. */
      style={photo ? { backgroundImage: `url("${generated}")`, backgroundSize: 'cover' } : undefined}
    >
      {photo ? (
        <img
          className="avatar-photo"
          src={src}
          width={size}
          height={size}
          alt=""
          onError={() => setFailed(true)}
        />
      ) : (
        <img src={generated} width={size} height={size} alt="" />
      )}
    </span>
  );
}
