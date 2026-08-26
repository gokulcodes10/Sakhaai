import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useSelector } from 'react-redux';
import api from '../../lib/api.js';
import { selectUser } from '../../features/auth/authSlice.js';
import { AdminPage } from '../../components/layout/AdminLayout.jsx';
import { Alert, Skeleton } from '../../components/ui/index.jsx';

export default function Dashboard() {
  const user = useSelector(selectUser);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get('/ops/dashboard')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  const firstName = user?.name?.split(' ')[0] ?? 'there';

  return (
    <AdminPage title={`Good to see you, ${firstName}.`} description={user?.title}>
      {error && <Alert tone="error" className="mb-6">{error}</Alert>}

      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Leads, all time" value={data.leads.total} to="/admin/leads" />
            <Tile label="Leads, last 30 days" value={data.leads.last30Days} to="/admin/leads" />
            <Tile label="Sakha conversations, 30 days" value={data.conversations.last30Days} to="/admin/conversations" />
            <Tile label="Active users" value={data.users} to="/admin/people" />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="card p-6">
              <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
                Sakha's knowledge
              </p>
              <p className="mt-3 font-display text-2xl font-semibold text-ink">
                {data.knowledge.documents} documents
              </p>
              <p className="mt-1.5 text-sm text-muted">
                {data.knowledge.lastIndexedAt
                  ? `Last rebuilt ${new Date(data.knowledge.lastIndexedAt).toLocaleString()}`
                  : 'Never rebuilt'}{' '}
                · status {data.knowledge.status}
              </p>
              <Link to="/admin/knowledge" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
                Manage the knowledge base
              </Link>
            </div>

            <div className="card p-6">
              <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
                Site content
              </p>
              <p className="mt-3 font-display text-2xl font-semibold text-ink">
                {data.content ? `Revision ${data.content.version}` : 'Not published'}
              </p>
              <p className="mt-1.5 text-sm text-muted">
                {data.content?.publishedAt
                  ? `Published ${new Date(data.content.publishedAt).toLocaleString()}`
                  : 'Publish from the CMS to make edits live.'}
              </p>
              <Link to="/admin/content" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
                Open the CMS
              </Link>
            </div>
          </div>
        </>
      )}
    </AdminPage>
  );
}

function Tile({ label, value, to }) {
  return (
    <Link to={to} className="card p-5 transition-shadow hover:shadow-card">
      <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">{label}</p>
      <p className="mt-3 font-display text-3xl font-semibold text-ink">{value}</p>
    </Link>
  );
}
