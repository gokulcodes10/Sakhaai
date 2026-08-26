import { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import clsx from 'clsx';
import api from '../../lib/api.js';
import { selectCan } from '../../features/auth/authSlice.js';
import { AdminPage } from '../../components/layout/AdminLayout.jsx';
import { Alert, Badge, EmptyState, Input, Select, Skeleton } from '../../components/ui/index.jsx';

const STAGES = [
  { value: 'new', label: 'New' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'memo_sent', label: 'Memo sent' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

export default function Leads() {
  const canWrite = useSelector(selectCan('crm.leads.write'));
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: '50' });
    if (q) params.set('q', q);
    if (stage) params.set('stage', stage);
    const res = await api.get(`/leads/admin?${params}`);
    setData(res);
  }, [q, stage]);

  useEffect(() => {
    const t = setTimeout(() => load().catch((e) => setError(e.message)), 250);
    return () => clearTimeout(t);
  }, [load]);

  async function open(lead) {
    const res = await api.get(`/leads/admin/${lead.id}`);
    setSelected(res.lead);
  }

  async function setStageFor(lead, next) {
    await api.patch(`/leads/admin/${lead.id}`, { stage: next });
    await load();
    if (selected?.id === lead.id) setSelected({ ...selected, stage: next });
  }

  return (
    <AdminPage
      title="Leads"
      description="Everything that came in through the contact form or through Sakha. Reply within 24 hours — that promise is on the website."
      actions={
        <>
          <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 w-48" />
          <Select value={stage} onChange={(e) => setStage(e.target.value)} className="h-9 w-40">
            <option value="">All stages</option>
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </>
      }
    >
      {error && <Alert tone="error" className="mb-6">{error}</Alert>}

      {!data ? (
        <Skeleton className="h-80" />
      ) : data.items.length === 0 ? (
        <EmptyState
          title="No leads yet."
          body="They will appear here the moment someone uses the contact form or Sakha passes one along."
        />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              {STAGES.map((s) => (
                <Badge key={s.value} tone={s.value === 'won' ? 'success' : 'neutral'}>
                  {s.label} {data.stageCounts?.[s.value] ?? 0}
                </Badge>
              ))}
            </div>

            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
              {data.items.map((lead) => (
                <li key={lead.id}>
                  <button
                    type="button"
                    onClick={() => open(lead)}
                    className={clsx(
                      'w-full px-4 py-3.5 text-left transition-colors',
                      selected?.id === lead.id ? 'bg-accent-soft' : 'hover:bg-raised'
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="truncate text-sm font-medium text-ink">
                        {lead.name}
                        {lead.company && <span className="text-muted"> · {lead.company}</span>}
                      </p>
                      <span className="shrink-0 text-2xs text-subtle">
                        {new Date(lead.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{lead.workflow}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge tone={lead.stage === 'won' ? 'success' : lead.stage === 'lost' ? 'danger' : 'neutral'}>
                        {lead.stage.replace('_', ' ')}
                      </Badge>
                      {lead.source === 'sakha-assistant' && <Badge tone="accent">via Sakha</Badge>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            {!selected ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-line p-12">
                <p className="text-sm text-muted">Pick a lead to read it.</p>
              </div>
            ) : (
              <article className="rounded-lg border border-line bg-surface">
                <header className="border-b border-line p-5">
                  <h2 className="font-display text-xl font-semibold text-ink">{selected.name}</h2>
                  <p className="mt-1 text-sm text-muted">
                    <a href={`mailto:${selected.email}`} className="hover:text-accent">
                      {selected.email}
                    </a>
                    {selected.phone && <> · {selected.phone}</>}
                  </p>
                  {selected.company && <p className="text-sm text-subtle">{selected.company}</p>}

                  {canWrite && (
                    <div className="mt-4 max-w-[12rem]">
                      <Select value={selected.stage} onChange={(e) => setStageFor(selected, e.target.value)}>
                        {STAGES.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                </header>

                <div className="p-5">
                  <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
                    The workflow they described
                  </p>
                  <p className="mt-2 whitespace-pre-wrap leading-relaxed text-ink">{selected.workflow}</p>

                  {selected.budgetTier && (
                    <p className="mt-4 text-sm text-muted">
                      Budget indicated: <span className="text-ink">{selected.budgetTier}</span>
                    </p>
                  )}

                  {selected.conversation?.messages?.length > 0 && (
                    <div className="mt-7 border-t border-line pt-5">
                      <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
                        The conversation with Sakha that produced this
                      </p>
                      <ul className="mt-3 space-y-3">
                        {selected.conversation.messages.map((m, i) => (
                          <li key={i} className={clsx('text-sm leading-relaxed', m.role === 'user' ? 'text-ink' : 'text-muted')}>
                            <span className="font-mono text-2xs uppercase text-subtle">{m.role}</span>
                            <p className="mt-0.5 whitespace-pre-wrap">{m.content}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </article>
            )}
          </div>
        </div>
      )}
    </AdminPage>
  );
}
