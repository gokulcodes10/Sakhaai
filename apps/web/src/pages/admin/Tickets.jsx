import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useSelector } from 'react-redux';
import clsx from 'clsx';
import api from '../../lib/api.js';
import { selectCan } from '../../features/auth/authSlice.js';
import { AdminPage } from '../../components/layout/AdminLayout.jsx';
import { Alert, Button, EmptyState, Field, Input, Select, Skeleton, Textarea } from '../../components/ui/index.jsx';
import {
  CATEGORIES,
  PRIORITIES,
  PriorityMark,
  STATUS_LABEL,
  StatusPill,
  ThreadMessage,
} from '../../components/support/TicketBits.jsx';

const STATUS_FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Waiting on client' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];

const requesterOf = (t) => t.raisedBy?.name ?? t.requesterName ?? t.requesterEmail ?? 'Unknown';

// ── Queue ─────────────────────────────────────────────────────────────────────

export default function Tickets() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('active');
  const [assignee, setAssignee] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams({ status, limit: '50' });
    if (assignee) params.set('assignee', assignee);
    if (q) params.set('q', q);
    setData(await api.get(`/support/tickets?${params}`));
  }, [status, assignee, q]);

  useEffect(() => {
    const t = setTimeout(() => load().catch((e) => setError(e.message)), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <AdminPage
      title="Support"
      description="Client tickets and Sakha handoffs to a human. Anything raised through Sakha has the conversation attached."
      actions={
        <>
          <Input placeholder="Search or #number…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 w-48" />
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-9 w-40">
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="none">Unassigned</option>
          </Select>
        </>
      }
    >
      {error && <Alert tone="error" className="mb-6">{error}</Alert>}

      <div className="mb-5 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => {
          const n =
            f.value === 'active'
              ? (data?.counts?.open ?? 0) + (data?.counts?.pending ?? 0)
              : f.value === 'all'
                ? null
                : (data?.counts?.[f.value] ?? 0);
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatus(f.value)}
              className={clsx(
                'rounded-sm border px-3 py-1.5 text-sm transition-colors',
                status === f.value ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-muted hover:border-ink'
              )}
            >
              {f.label}
              {n !== null && <span className="ml-2 font-mono text-xs opacity-70">{n}</span>}
            </button>
          );
        })}
      </div>

      {!data ? (
        <Skeleton className="h-80" />
      ) : data.items.length === 0 ? (
        <EmptyState title="Nothing here." body="Tickets appear when a client raises one in the portal, or Sakha hands someone to a human." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line font-mono text-2xs uppercase tracking-[0.12em] text-subtle">
              <tr>
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Subject</th>
                <th className="px-4 py-3 font-medium">From</th>
                <th className="px-4 py-3 font-medium">Assignee</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.id} className="border-t border-line first:border-0 hover:bg-paper">
                  <td className="px-4 py-3 font-mono text-trust">
                    <Link to={`/admin/tickets/${t.id}`}>#{t.number}</Link>
                  </td>
                  <td className="max-w-[22rem] px-4 py-3">
                    <Link to={`/admin/tickets/${t.id}`} className="block truncate font-medium text-ink hover:text-accent">
                      {t.subject}
                    </Link>
                    <span className="flex gap-3">
                      <PriorityMark priority={t.priority} />
                      {t.source === 'sakha' && (
                        <span className="font-mono text-2xs uppercase tracking-[0.12em] text-trust">via Sakha</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {requesterOf(t)}
                    <span className="block text-xs text-subtle">{t.clientAccount?.name ?? 'Visitor'}</span>
                  </td>
                  <td className="px-4 py-3 text-muted">{t.assignee?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={t.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-subtle">
                    {new Date(t.lastActivityAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminPage>
  );
}

// ── One ticket ────────────────────────────────────────────────────────────────

export function TicketDetail() {
  const { id } = useParams();
  const canWrite = useSelector(selectCan('support.tickets.write'));
  const [ticket, setTicket] = useState(null);
  const [assignees, setAssignees] = useState([]);
  const [error, setError] = useState(null);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get(`/support/tickets/${id}`)
      .then((r) => setTicket(r.ticket))
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (canWrite) api.get('/support/assignees').then((r) => setAssignees(r.users)).catch(() => {});
  }, [canWrite]);

  async function act(fn) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      setTicket(r.ticket);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const patch = (body) => act(() => api.patch(`/support/tickets/${id}`, body));

  const send = async (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    if (await act(() => api.post(`/support/tickets/${id}/messages`, { body: reply, internal }))) {
      setReply('');
      setInternal(false);
    }
  };

  if (!ticket) {
    return (
      <AdminPage title="Ticket">
        {error ? <Alert tone="error">{error}</Alert> : <Skeleton className="h-80" />}
      </AdminPage>
    );
  }

  const requesterEmail = ticket.raisedBy?.email ?? ticket.requesterEmail;

  return (
    <AdminPage
      title={`#${ticket.number} · ${ticket.subject}`}
      description={`${requesterOf(ticket)}${ticket.clientAccount ? ` · ${ticket.clientAccount.name}` : ' · not a client account'}`}
      actions={
        <Button to="/admin/tickets" variant="outline" size="sm">
          ← Queue
        </Button>
      }
    >
      {error && <Alert tone="error" className="mb-6">{error}</Alert>}

      <div className="grid gap-10 lg:grid-cols-[1fr_18rem]">
        <div>
          <ul className="space-y-3">
            <ThreadMessage
              viewer="staff"
              message={{
                authorType: 'client',
                author: { name: requesterOf(ticket) },
                body: ticket.body,
                createdAt: ticket.createdAt,
              }}
            />
            {ticket.messages.map((m) => (
              <ThreadMessage key={m.id} message={m} viewer="staff" />
            ))}
          </ul>

          {canWrite && (
            <form onSubmit={send} className="mt-8 space-y-3">
              <Field label={internal ? 'Internal note (the client never sees it)' : `Reply to ${requesterOf(ticket)}`}>
                <Textarea
                  rows={5}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  className={internal ? 'border-dashed border-keystone/60' : undefined}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-4">
                <Button type="submit" variant={internal ? 'outline' : 'accent'} loading={busy} disabled={!reply.trim()}>
                  {internal ? 'Add note' : 'Send reply'}
                </Button>
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                  Internal note
                </label>
                {!internal && requesterEmail && (
                  <span className="text-xs text-subtle">Emailed to {requesterEmail}</span>
                )}
              </div>
            </form>
          )}
        </div>

        <aside className="space-y-5 text-sm lg:border-l lg:border-line lg:pl-8">
          <Control label="Status">
            {canWrite ? (
              <Select value={ticket.status} onChange={(e) => patch({ status: e.target.value })} disabled={busy}>
                {Object.entries(STATUS_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            ) : (
              <StatusPill status={ticket.status} />
            )}
          </Control>
          <Control label="Priority">
            {canWrite ? (
              <Select value={ticket.priority} onChange={(e) => patch({ priority: e.target.value })} disabled={busy}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            ) : (
              ticket.priority
            )}
          </Control>
          <Control label="Type">
            {canWrite ? (
              <Select
                value={ticket.category ?? ''}
                onChange={(e) => patch({ category: e.target.value || null })}
                disabled={busy}
              >
                <option value="">—</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            ) : (
              (ticket.category ?? '—')
            )}
          </Control>
          <Control label="Assignee">
            {canWrite ? (
              <Select
                value={ticket.assignee?.id ?? ''}
                onChange={(e) => patch({ assigneeId: e.target.value || null })}
                disabled={busy}
              >
                <option value="">Unassigned</option>
                {assignees.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            ) : (
              (ticket.assignee?.name ?? 'Unassigned')
            )}
          </Control>
          <Control label="Requester">
            <p className="text-ink">{requesterOf(ticket)}</p>
            {requesterEmail && <p className="font-mono text-xs text-subtle">{requesterEmail}</p>}
          </Control>
          <Control label="Source">
            <p className="text-ink">{ticket.source === 'sakha' ? 'Sakha' : ticket.source}</p>
            {ticket.conversation && (
              <Link to={`/admin/conversations?open=${ticket.conversation.id}`} className="text-accent hover:underline">
                Read the Sakha conversation →
              </Link>
            )}
          </Control>
          <Control label="Opened">{new Date(ticket.createdAt).toLocaleString()}</Control>
        </aside>
      </div>
    </AdminPage>
  );
}

function Control({ label, children }) {
  return (
    <div>
      <p className="mb-1.5 font-mono text-2xs uppercase tracking-[0.14em] text-subtle">{label}</p>
      <div className="capitalize">{children}</div>
    </div>
  );
}
