import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../net/api.ts';

/* Placeholders for two later phases: the profile page and the per-hand replay.
   Both routes exist now so links from the table are never dead; each shows the
   JSON its endpoint returns until the real view is built. */

export function Profile() {
  const { name = '' } = useParams();
  return (
    <Raw
      title={name}
      subtitle="Profile. Rating history and match list land here in a later phase."
      load={() => api.user(name)}
      dep={name}
    />
  );
}

export function HandReplay() {
  const { id = '', n = '1' } = useParams();
  return (
    <Raw
      title={`Hand ${n}`}
      subtitle="Replay and shuffle verification land here in a later phase."
      load={() => api.hand(id, Number(n))}
      dep={`${id}:${n}`}
    />
  );
}

function Raw({
  title,
  subtitle,
  load,
  dep,
}: {
  title: string;
  subtitle: string;
  load: () => Promise<unknown>;
  dep: string;
}) {
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    load()
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
    // load is rebuilt each render; dep is the real identity of the request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);

  return (
    <main className="page stack">
      <div className="prose">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {error ? (
        <div className="card">
          <div className="empty">
            <span className="e-title">Nothing came back</span>
            <span className="e-desc">{error}. The endpoint may not be built yet.</span>
          </div>
        </div>
      ) : data == null ? (
        <span className="muted">Loading</span>
      ) : (
        <pre className="jsonbox">{JSON.stringify(data, null, 2)}</pre>
      )}
    </main>
  );
}
