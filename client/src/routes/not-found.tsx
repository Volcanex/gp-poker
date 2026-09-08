import { Link } from 'react-router-dom';

/* The one "there is nothing here" page. Its own file rather than a helper
   inside app.tsx because the admin pages render it too: a page somebody is
   not allowed to see and a page that does not exist should look the same,
   and the way to keep them the same is to render the same thing. */
export function NotFound() {
  return (
    <main className="page">
      <div className="card">
        <div className="empty">
          <span className="e-title">No page here</span>
          <span className="e-desc">The link may be old. Start a match from the home page.</span>
          <Link className="btn btn-secondary btn-sm" to="/">Go to the home page</Link>
        </div>
      </div>
    </main>
  );
}
