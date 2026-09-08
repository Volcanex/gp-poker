import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../net/api.ts';

/* A link to a hand somebody actually played, so a lesson can point at the
   real thing rather than an illustration of it. The latest finished match's
   first hand: every finished match has one. */
export function LatestHandLink({ label }: { label: string }) {
  const [id, setId] = useState<string | null>(null);
  const [none, setNone] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .recent(1)
      .then((rows) => {
        if (!live) return;
        if (rows.length === 0) setNone(true);
        else setId(rows[0].id);
      })
      .catch(() => live && setNone(true));
    return () => {
      live = false;
    };
  }, []);

  if (none) return <span className="muted">No hands have been played yet, so there is nothing to open.</span>;
  if (!id) return <span className="skeleton skeleton-text" style={{ width: 140, display: 'inline-block' }} />;
  return <Link to={`/m/${id}/h/1`}>{label}</Link>;
}
