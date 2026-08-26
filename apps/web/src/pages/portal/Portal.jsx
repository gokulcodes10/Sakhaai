import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import clsx from 'clsx';
import api from '../../lib/api.js';
import { selectUser } from '../../features/auth/authSlice.js';
import { openPanel } from '../../features/sakha/sakhaSlice.js';
import { Alert, Badge, Button, EmptyState, Section, Skeleton, Stat } from '../../components/ui/index.jsx';
import Seo from '../../components/layout/Seo.jsx';
import PageHero from '../../components/layout/PageHero.jsx';

const AUTONOMY = ['Shadow', 'Supervised', 'Autonomous with exceptions', 'Autonomous'];

export default function Portal() {
  const user = useSelector(selectUser);
  const dispatch = useDispatch();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/portal/overview').then(setData).catch((err) => setError(err.message));
  }, []);

  return (
    <>
      <Seo title="Client portal" noindex />
      <PageHero
        eyebrow="Client portal"
        title={`Hello, ${user?.name?.split(' ')[0] ?? 'there'}.`}
        subhead={data?.account ? data.account.name : 'Your projects, documents and the metric each agent is measured against.'}
      />

      <Section>
        {error ? (
          <Alert tone="info">
            {error}
            <p className="mt-3">
              <Button variant="outline" size="sm" onClick={() => dispatch(openPanel())}>
                Ask Sakha about it
              </Button>
            </p>
          </Alert>
        ) : !data ? (
          <div className="space-y-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        ) : data.projects.length === 0 ? (
          <EmptyState
            title="No projects yet."
            body="Once an engagement starts, its status, metric and documents appear here."
            action={<Button to="/contact" variant="accent">Talk to a founder</Button>}
          />
        ) : (
          <div className="space-y-8">
            {data.projects.map((p) => (
              <article key={p.id} className="rounded-lg border border-line bg-surface p-7">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="font-display text-2xl font-semibold text-ink">{p.name}</h2>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge tone={p.status === 'live' ? 'success' : 'neutral'}>{p.status.replace('_', ' ')}</Badge>
                      {p.tier && <Badge>{p.tier}</Badge>}
                      <Badge tone="trust">
                        Autonomy {p.autonomyLevel} · {AUTONOMY[p.autonomyLevel] ?? '—'}
                      </Badge>
                    </div>
                  </div>
                  {p.liveAt && (
                    <p className="text-sm text-subtle">Live since {new Date(p.liveAt).toLocaleDateString()}</p>
                  )}
                </div>

                {p.summary && <p className="mt-5 max-w-prose leading-relaxed text-muted">{p.summary}</p>}

                {p.metricLabel && (
                  <div className="mt-7 grid gap-6 border-t border-line pt-6 sm:grid-cols-3">
                    <Stat label={p.metricLabel} value={p.metricCurrent ?? '—'} note="current" />
                    <Stat label="Baseline" value={p.metricBaseline ?? '—'} note="before we started" tone="line" />
                  </div>
                )}

                {p.updates?.length > 0 && (
                  <div className="mt-7 border-t border-line pt-6">
                    <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
                      Latest updates
                    </p>
                    <ul className="mt-3 space-y-3">
                      {p.updates.map((u) => (
                        <li key={u.id} className={clsx('border-l-2 pl-4', u.kind === 'incident' ? 'border-danger' : 'border-line')}>
                          <p className="text-sm font-medium text-ink">{u.title}</p>
                          <p className="mt-0.5 text-xs text-subtle">{new Date(u.createdAt).toLocaleDateString()}</p>
                          <p className="mt-1.5 text-sm leading-relaxed text-muted">{u.body}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            ))}

            <div className="rounded-lg bg-ink p-7 text-paper">
              <p className="font-display text-xl font-semibold">Sakha knows your account too.</p>
              <p className="mt-2 max-w-prose text-paper/70">
                Signed in, she can answer questions about your own projects — status, autonomy level,
                the metric we agreed — not just the public site.
              </p>
              <Button variant="accent" className="mt-5" onClick={() => dispatch(openPanel())}>
                Ask Sakha
              </Button>
            </div>
          </div>
        )}
      </Section>
    </>
  );
}
