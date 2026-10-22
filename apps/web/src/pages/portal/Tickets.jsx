import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useDispatch } from 'react-redux';
import api, { ApiError } from '../../lib/api.js';
import { askSakha } from '../../features/sakha/sakhaSlice.js';
import { Alert, Button, EmptyState, Field, Input, Section, Select, Skeleton, Textarea } from '../../components/ui/index.jsx';
import { CATEGORIES, CLIENT_STATUS_LABEL, PriorityMark, StatusPill, ThreadMessage } from '../../components/support/TicketBits.jsx';
import Seo from '../../components/layout/Seo.jsx';
import PageHero from '../../components/layout/PageHero.jsx';

// ── List + new ticket ─────────────────────────────────────────────────────────

export function Tickets() {
  const dispatch = useDispatch();
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    api
      .get('/portal/tickets')
      .then((r) => setTickets(r.tickets))
      .catch((err) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  return (
    <>
      <Seo title="Support tickets" noindex />
      <PageHero
        eyebrow="Client portal"
        title="Support tickets."
        subhead="Everything you have raised with us, and where each one stands. Sakha can raise and follow up tickets for you too."
        back={{ href: '/portal', label: 'Portal' }}
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <Button variant="accent" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'Raise a ticket'}
          </Button>
          <Button variant="outline" onClick={() => dispatch(askSakha('I need help with something on our account.'))}>
            Ask Sakha first
          </Button>
        </div>
      </PageHero>

      <Section>
        {showForm && (
          <NewTicket
            onCreated={() => {
              setShowForm(false);
              load();
            }}
          />
        )}

        {error ? (
          <Alert tone="info">{error}</Alert>
        ) : !tickets ? (
          <div className="space-y-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : tickets.length === 0 ? (
          !showForm && (
            <EmptyState
              title="No tickets yet."
              body="When something needs the team's attention, raise it here or ask Sakha to."
            />
          )
        ) : (
          <ul className="overflow-hidden rounded-lg border border-line bg-surface">
            {tickets.map((t) => (
              <li key={t.id} className="border-t border-line first:border-0">
                <Link
                  to={`/portal/tickets/${t.id}`}
                  className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-4 px-5 py-4 transition-colors hover:bg-paper"
                >
                  <span className="font-mono text-sm text-trust">#{t.number}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{t.subject}</span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-subtle">
                      <span>Updated {new Date(t.lastActivityAt).toLocaleDateString()}</span>
                      {t.raisedBy?.name && <span>by {t.raisedBy.name}</span>}
                      {t.source === 'sakha' && <span>via Sakha</span>}
                      <PriorityMark priority={t.priority} />
                    </span>
                  </span>
                  <StatusPill status={t.status} labels={CLIENT_STATUS_LABEL} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function NewTicket({ onCreated }) {
  const [values, setValues] = useState({ subject: '', body: '', priority: 'normal', category: 'question' });
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);
  const [serverError, setServerError] = useState(null);
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSending(true);
    setServerError(null);
    try {
      await api.post('/portal/tickets', values);
      onCreated();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      setServerError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mb-10 space-y-5 p-6" noValidate>
      {serverError && <Alert tone="error">{serverError}</Alert>}
      <Field label="Subject" required error={errors.subject}>
        <Input value={values.subject} onChange={set('subject')} error={errors.subject} maxLength={200} />
      </Field>
      <Field label="What is happening?" hint="What you expected, what happened instead, and when." required error={errors.body}>
        <Textarea rows={6} value={values.body} onChange={set('body')} error={errors.body} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Priority" hint="Urgent means a live agent is down or wrong in front of your customers.">
          <Select value={values.priority} onChange={set('priority')}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High — work is blocked</option>
            <option value="urgent">Urgent — production issue</option>
          </Select>
        </Field>
        <Field label="Type">
          <Select value={values.category} onChange={set('category')}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c[0].toUpperCase() + c.slice(1)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Button type="submit" variant="accent" loading={sending}>
        Raise ticket
      </Button>
    </form>
  );
}

// ── One ticket ────────────────────────────────────────────────────────────────

export function TicketDetail() {
  const { id } = useParams();
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get(`/portal/tickets/${id}`)
      .then((r) => setTicket(r.ticket))
      .catch((err) => setError(err.message));
  }, [id]);

  async function act(fn) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      setTicket(r.ticket);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const send = async (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    if (await act(() => api.post(`/portal/tickets/${id}/messages`, { body: reply }))) setReply('');
  };

  return (
    <>
      <Seo title={ticket ? `Ticket #${ticket.number}` : 'Ticket'} noindex />
      <Section>
        <Link to="/portal/tickets" className="text-sm text-muted hover:text-accent">
          ← All tickets
        </Link>

        {error && !ticket ? (
          <Alert tone="info" className="mt-6">{error}</Alert>
        ) : !ticket ? (
          <Skeleton className="mt-6 h-40" />
        ) : (
          <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_16rem]">
            <div>
              <p className="font-mono text-sm text-trust">#{ticket.number}</p>
              <h1 className="mt-2 text-3xl">{ticket.subject}</h1>

              <ul className="mt-8 space-y-3">
                <ThreadMessage
                  message={{
                    authorType: 'client',
                    author: ticket.raisedBy ?? { name: ticket.source === 'sakha' ? 'Raised through Sakha' : 'You' },
                    body: ticket.body,
                    createdAt: ticket.createdAt,
                  }}
                />
                {ticket.messages.map((m) => (
                  <ThreadMessage key={m.id} message={m} />
                ))}
              </ul>

              {error && <Alert tone="error" className="mt-5">{error}</Alert>}

              {ticket.status === 'closed' ? (
                <p className="mt-8 text-sm text-subtle">
                  This ticket is closed. If the problem is back, raise a new one and mention #{ticket.number}.
                </p>
              ) : (
                <form onSubmit={send} className="mt-8 space-y-3">
                  <Field label="Reply">
                    <Textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} />
                  </Field>
                  <div className="flex flex-wrap gap-3">
                    <Button type="submit" variant="accent" loading={busy} disabled={!reply.trim()}>
                      Send reply
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => act(() => api.post(`/portal/tickets/${id}/close`))}
                    >
                      Close ticket
                    </Button>
                  </div>
                </form>
              )}
            </div>

            <aside className="space-y-4 text-sm lg:border-l lg:border-line lg:pl-8">
              <Meta label="Status">
                <StatusPill status={ticket.status} labels={CLIENT_STATUS_LABEL} />
              </Meta>
              <Meta label="Priority">{ticket.priority}</Meta>
              {ticket.category && <Meta label="Type">{ticket.category}</Meta>}
              <Meta label="Handled by">{ticket.assignee?.name ?? 'The Asphalix team'}</Meta>
              <Meta label="Opened">{new Date(ticket.createdAt).toLocaleString()}</Meta>
            </aside>
          </div>
        )}
      </Section>
    </>
  );
}

function Meta({ label, children }) {
  return (
    <div>
      <p className="font-mono text-2xs uppercase tracking-[0.14em] text-subtle">{label}</p>
      <div className="mt-1 capitalize text-ink">{children}</div>
    </div>
  );
}
