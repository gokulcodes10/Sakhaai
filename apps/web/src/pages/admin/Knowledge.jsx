import { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import api from '../../lib/api.js';
import { selectCan } from '../../features/auth/authSlice.js';
import { AdminPage } from '../../components/layout/AdminLayout.jsx';
import { Alert, Badge, Button, Field, Input, Select, Skeleton } from '../../components/ui/index.jsx';

const SOURCE_LABELS = {
  cms: 'Site content',
  doc: 'Documents',
  crawl: 'Public web',
  db: 'Live data',
  manual: 'Written here',
};

export default function Knowledge() {
  const canReindex = useSelector(selectCan('knowledge.reindex'));
  const canSettings = useSelector(selectCan('knowledge.settings.write'));
  const canSources = useSelector(selectCan('knowledge.sources.write'));

  const [overview, setOverview] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hours, setHours] = useState(10);
  const [newSource, setNewSource] = useState('');

  const load = useCallback(async () => {
    const data = await api.get('/knowledge');
    setOverview(data);
    setHours(data.settings.refreshHours);
  }, []);

  useEffect(() => {
    load().catch((err) => setStatus({ tone: 'error', message: err.message }));
  }, [load]);

  async function reindex(sources) {
    setBusy(true);
    try {
      const res = await api.post('/knowledge/reindex', { sources });
      setStatus({ tone: 'success', message: res.message });
      setTimeout(() => load().catch(() => {}), 3000);
    } catch (err) {
      setStatus({ tone: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function search(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      const res = await api.post('/knowledge/search', { query, limit: 8 });
      setResults(res.results);
    } catch (err) {
      setStatus({ tone: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function saveSchedule() {
    setBusy(true);
    try {
      const res = await api.put('/knowledge/settings', { refreshHours: Number(hours) });
      setStatus({ tone: 'success', message: res.message });
      await load();
    } catch (err) {
      setStatus({ tone: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function addSource(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/knowledge/sources', { url: newSource, enabled: true, maxPages: 20 });
      setNewSource('');
      await load();
      setStatus({ tone: 'success', message: 'Source added. It is read on the next full rebuild.' });
    } catch (err) {
      setStatus({ tone: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage
      title="Sakha's knowledge"
      description="What the assistant knows, where it came from, and when it was last refreshed. Publishing site content rebuilds this immediately."
      actions={
        canReindex && (
          <>
            <Button size="sm" variant="outline" onClick={() => reindex(['cms', 'doc', 'db'])} loading={busy}>
              Quick rebuild
            </Button>
            <Button size="sm" variant="accent" onClick={() => reindex(['cms', 'doc', 'db', 'crawl'])} loading={busy}>
              Full rebuild + crawl
            </Button>
          </>
        )
      }
    >
      {status && (
        <Alert tone={status.tone === 'error' ? 'error' : 'success'} className="mb-6">
          {status.message}
        </Alert>
      )}

      {!overview ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Documents" value={overview.totalDocuments} />
            <Tile label="Chunks" value={overview.totalChunks} />
            <Tile
              label="Last rebuilt"
              value={
                overview.runs[0]?.finishedAt
                  ? new Date(overview.runs[0].finishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : '—'
              }
              note={overview.runs[0]?.finishedAt ? new Date(overview.runs[0].finishedAt).toLocaleDateString() : 'never'}
            />
            <Tile label="Refresh cadence" value={`${overview.settings.refreshHours}h`} note="plus instant on publish" />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card p-6">
              <h2 className="font-display text-lg font-semibold text-ink">Where it comes from</h2>
              <ul className="mt-4 space-y-2.5">
                {Object.entries(overview.documents).map(([source, count]) => (
                  <li key={source} className="flex items-center justify-between border-b border-line pb-2.5 last:border-0">
                    <span className="text-sm text-ink">{SOURCE_LABELS[source] ?? source}</span>
                    <span className="font-mono text-sm text-muted">{count}</span>
                  </li>
                ))}
              </ul>

              {canSettings && (
                <div className="mt-6 border-t border-line pt-5">
                  <Field label="Rebuild every" hint="Between 1 and 168 hours. Takes effect when the worker restarts.">
                    <div className="flex gap-2">
                      <Select value={hours} onChange={(e) => setHours(e.target.value)} className="max-w-[9rem]">
                        <option value={1}>1 hour</option>
                        <option value={3}>3 hours</option>
                        <option value={6}>6 hours</option>
                        <option value={10}>10 hours</option>
                        <option value={24}>24 hours</option>
                      </Select>
                      <Button variant="outline" onClick={saveSchedule} loading={busy}>
                        Save
                      </Button>
                    </div>
                  </Field>
                </div>
              )}
            </section>

            <section className="card p-6">
              <h2 className="font-display text-lg font-semibold text-ink">Public sources</h2>
              <p className="mt-1 text-sm text-muted">
                Pages Sakha reads on the schedule. robots.txt is honoured.
              </p>
              <ul className="mt-4 space-y-2.5">
                {overview.crawlSources.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-3 border-b border-line pb-2.5 last:border-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{s.url}</p>
                      <p className="text-xs text-subtle">
                        {s.lastCrawledAt
                          ? `${s.pagesFound} pages · ${new Date(s.lastCrawledAt).toLocaleDateString()}`
                          : 'not crawled yet'}
                      </p>
                    </div>
                    <Badge tone={s.lastStatus === 'ok' ? 'success' : s.lastStatus ? 'warning' : 'neutral'}>
                      {s.lastStatus ?? 'pending'}
                    </Badge>
                  </li>
                ))}
              </ul>

              {canSources && (
                <form onSubmit={addSource} className="mt-5 flex gap-2 border-t border-line pt-5">
                  <Input
                    type="url"
                    placeholder="https://…"
                    value={newSource}
                    onChange={(e) => setNewSource(e.target.value)}
                    required
                  />
                  <Button variant="outline" type="submit" loading={busy}>
                    Add
                  </Button>
                </form>
              )}
            </section>
          </div>

          <section className="card p-6">
            <h2 className="font-display text-lg font-semibold text-ink">Try a question</h2>
            <p className="mt-1 text-sm text-muted">
              The quickest way to debug a bad answer: see exactly what Sakha would retrieve.
            </p>

            <form onSubmit={search} className="mt-4 flex gap-2">
              <Input
                placeholder="What does a pilot include?"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Button type="submit" variant="outline" loading={busy}>
                Search
              </Button>
            </form>

            {results && (
              <ul className="mt-5 space-y-3">
                {results.length === 0 && (
                  <li className="rounded-md border border-warning/30 bg-warning/5 p-4 text-sm text-warning">
                    Nothing matched. Sakha would say she does not know — which is correct, but if this
                    is a question you get often, write a document for it.
                  </li>
                )}
                {results.map((r) => (
                  <li key={r.title + r.heading} className="rounded-md border border-line bg-paper p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-medium text-ink">
                        {r.title}
                        {r.heading && r.heading !== r.title && <span className="text-muted"> › {r.heading}</span>}
                      </p>
                      <span className="shrink-0 font-mono text-2xs text-subtle">{r.score.toFixed(2)}</span>
                    </div>
                    <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted">{r.excerpt}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-6">
            <h2 className="font-display text-lg font-semibold text-ink">Recent rebuilds</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-2xs uppercase tracking-wide text-subtle">
                    <th className="pb-2 font-semibold">Trigger</th>
                    <th className="pb-2 font-semibold">Status</th>
                    <th className="pb-2 text-right font-semibold">Seen</th>
                    <th className="pb-2 text-right font-semibold">Changed</th>
                    <th className="pb-2 text-right font-semibold">Took</th>
                    <th className="pb-2 text-right font-semibold">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {overview.runs.map((run) => (
                    <tr key={run.id}>
                      <td className="py-2.5 text-ink">{run.trigger}</td>
                      <td className="py-2.5">
                        <Badge tone={run.status === 'ok' ? 'success' : run.status === 'failed' ? 'danger' : 'warning'}>
                          {run.status}
                        </Badge>
                      </td>
                      <td className="py-2.5 text-right font-mono text-muted">{run.documentsSeen}</td>
                      <td className="py-2.5 text-right font-mono text-muted">{run.documentsChanged}</td>
                      <td className="py-2.5 text-right font-mono text-muted">{run.durationMs ?? '—'}ms</td>
                      <td className="py-2.5 text-right text-subtle">
                        {new Date(run.startedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </AdminPage>
  );
}

function Tile({ label, value, note }) {
  return (
    <div className="card p-5">
      <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">{label}</p>
      <p className="mt-2.5 font-display text-2xl font-semibold text-ink">{value}</p>
      {note && <p className="mt-1 text-xs text-subtle">{note}</p>}
    </div>
  );
}
