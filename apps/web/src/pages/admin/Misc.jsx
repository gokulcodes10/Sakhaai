/** The smaller admin screens: roles, audit, conversations, Sakha tuning, pages, media. */

import { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import clsx from 'clsx';
import api from '../../lib/api.js';
import { selectCan } from '../../features/auth/authSlice.js';
import { AdminPage } from '../../components/layout/AdminLayout.jsx';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  Textarea,
} from '../../components/ui/index.jsx';

// ── Roles ─────────────────────────────────────────────────────────────────────

export function Roles() {
  const canGrant = useSelector(selectCan('iam.grant'));
  const canCreate = useSelector(selectCan('iam.roles.write'));

  const [roles, setRoles] = useState(null);
  const [catalogue, setCatalogue] = useState([]);
  const [active, setActive] = useState(null);
  const [selection, setSelection] = useState(new Set());
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', description: '', rank: 30 });

  const load = useCallback(async () => {
    const [r, p] = await Promise.all([api.get('/iam/roles'), api.get('/iam/permissions')]);
    setRoles(r.roles);
    setCatalogue(p.catalogue);
    return r.roles;
  }, []);

  useEffect(() => {
    load().catch((e) => setStatus({ tone: 'error', message: e.message }));
  }, [load]);

  function pick(role) {
    setActive(role);
    setSelection(new Set(role.permissions));
    setStatus(null);
  }

  async function save() {
    setBusy(true);
    try {
      const res = await api.put(`/iam/roles/${active.id}/permissions`, { permissions: [...selection] });
      const fresh = await load();
      pick(fresh.find((r) => r.id === active.id));
      setStatus({
        tone: 'success',
        message: `${res.message} ${res.usersAffected} user(s) affected.`,
      });
    } catch (err) {
      setStatus({ tone: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/iam/roles', { ...draft, rank: Number(draft.rank), permissions: [] });
      setCreating(false);
      setDraft({ name: '', description: '', rank: 30 });
      await load();
      setStatus({ tone: 'success', message: 'Role created. Give it permissions below.' });
    } catch (err) {
      setStatus({ tone: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  const toggle = (key) =>
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <AdminPage
      title="Roles"
      description="A role is a named bundle of permissions. Change one here and every person holding it is updated immediately."
      actions={canCreate && <Button size="sm" variant="outline" onClick={() => setCreating((v) => !v)}>New role</Button>}
    >
      {status && (
        <Alert tone={status.tone === 'error' ? 'error' : 'success'} className="mb-6">
          {status.message}
        </Alert>
      )}

      {creating && (
        <form onSubmit={create} className="mb-6 space-y-4 rounded-lg border border-accent/30 bg-accent-soft/30 p-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name" required>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required placeholder="Content Editor" />
            </Field>
            <Field label="Rank" hint="Must be below your own.">
              <Input type="number" min={1} max={99} value={draft.rank} onChange={(e) => setDraft({ ...draft, rank: e.target.value })} />
            </Field>
            <Field label="Description">
              <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </Field>
          </div>
          <Button type="submit" variant="accent" loading={busy}>Create role</Button>
        </form>
      )}

      {!roles ? (
        <Skeleton className="h-80" />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_1.3fr]">
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {roles.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => pick(r)}
                  className={clsx(
                    'w-full px-4 py-3.5 text-left transition-colors',
                    active?.id === r.id ? 'bg-accent-soft' : 'hover:bg-raised'
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-ink">{r.name}</span>
                    <span className="flex items-center gap-2">
                      {r.isSystem && <Badge>system</Badge>}
                      <span className="font-mono text-2xs text-subtle">rank {r.rank}</span>
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{r.description}</p>
                  <p className="mt-1.5 text-2xs text-subtle">
                    {r.permissions.length} permissions · {r.userCount} {r.userCount === 1 ? 'person' : 'people'}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          <div>
            {!active ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-line p-12">
                <p className="text-sm text-muted">Pick a role to see what it can do.</p>
              </div>
            ) : (
              <div className="rounded-lg border border-line bg-surface p-5">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-display text-lg font-semibold text-ink">{active.name}</h2>
                    <p className="mt-0.5 text-xs text-muted">{active.userCount} holder(s)</p>
                  </div>
                  {canGrant && active.key !== 'super_admin' && (
                    <Button size="sm" variant="accent" onClick={save} loading={busy}>
                      Save permissions
                    </Button>
                  )}
                </div>

                {active.key === 'super_admin' && (
                  <Alert tone="info" className="mb-4">
                    The super admin role always holds every permission and cannot be reduced.
                  </Alert>
                )}

                <div className="space-y-5">
                  {catalogue.map((group) => (
                    <fieldset key={group.domain} className="rounded-md border border-line p-4">
                      <legend className="px-1.5 text-sm font-semibold text-ink">{group.label}</legend>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {group.permissions.map((p) => (
                          <label key={p.key} className="flex items-start gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={selection.has(p.key)}
                              disabled={!canGrant || !p.grantable || active.key === 'super_admin'}
                              onChange={() => toggle(p.key)}
                              className="mt-0.5 h-4 w-4 rounded border-line text-accent"
                            />
                            <span className="text-muted">{p.label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AdminPage>
  );
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export function Audit() {
  const [data, setData] = useState(null);
  const [action, setAction] = useState('');
  const [actions, setActions] = useState([]);

  useEffect(() => {
    api.get('/audit/actions').then((r) => setActions(r.actions)).catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ limit: '60' });
    if (action) params.set('action', action);
    api.get(`/audit?${params}`).then(setData).catch(() => {});
  }, [action]);

  return (
    <AdminPage
      title="Audit log"
      description="Append-only. Every permission change, publish and deletion, with who did it and from where."
      actions={
        <Select value={action} onChange={(e) => setAction(e.target.value)} className="h-9 w-56">
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a.action} value={a.action}>
              {a.action} ({a.count})
            </option>
          ))}
        </Select>
      }
    >
      {!data ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-raised">
              <tr className="text-left text-2xs uppercase tracking-wide text-subtle">
                <th className="px-4 py-2.5 font-semibold">When</th>
                <th className="px-4 py-2.5 font-semibold">Who</th>
                <th className="px-4 py-2.5 font-semibold">Action</th>
                <th className="px-4 py-2.5 font-semibold">Target</th>
                <th className="px-4 py-2.5 font-semibold">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.items.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-subtle">
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-ink">{row.actor?.name ?? row.actorEmail ?? 'system'}</td>
                  <td className="px-4 py-2.5">
                    <code className="font-mono text-xs text-accent">{row.action}</code>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">
                    {row.entity}
                    {row.entityId && <span className="block text-subtle">{row.entityId.slice(0, 12)}…</span>}
                  </td>
                  <td className="max-w-xs px-4 py-2.5">
                    {row.after && (
                      <code className="block truncate font-mono text-2xs text-subtle" title={JSON.stringify(row.after)}>
                        {JSON.stringify(row.after)}
                      </code>
                    )}
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

// ── Sakha conversations ───────────────────────────────────────────────────────

export function Conversations() {
  const [data, setData] = useState(null);
  const [insights, setInsights] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    api.get('/sakha/admin/conversations?limit=40').then(setData).catch(() => {});
    api.get('/sakha/admin/insights').then(setInsights).catch(() => {});
  }, []);

  return (
    <AdminPage
      title="Conversations"
      description="What visitors are actually asking Sakha. The unanswered ones are the most useful thing on this page."
    >
      {insights && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Conversations, 30 days" value={insights.conversations} />
          <Tile label="Leads Sakha captured" value={insights.leadsCaptured} />
          <Tile label="Rated helpful" value={insights.feedback?.up ?? 0} />
          <Tile
            label="Turns she could not answer"
            value={insights.unansweredTurns}
            note="each one is a gap in the knowledge base"
            tone={insights.unansweredTurns > 0 ? 'warning' : 'neutral'}
          />
        </div>
      )}

      {!data ? (
        <Skeleton className="h-80" />
      ) : data.items.length === 0 ? (
        <EmptyState title="No conversations yet." body="They appear here as soon as visitors start asking." />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {data.items.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => api.get(`/sakha/admin/conversations/${c.id}`).then((r) => setOpen(r.conversation))}
                  className={clsx(
                    'w-full px-4 py-3.5 text-left transition-colors',
                    open?.id === c.id ? 'bg-accent-soft' : 'hover:bg-raised'
                  )}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-medium text-ink">{c.title ?? 'Untitled'}</p>
                    <span className="shrink-0 text-2xs text-subtle">
                      {new Date(c.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted">{c.messages[0]?.content}</p>
                  <div className="mt-2 flex items-center gap-2 text-2xs text-subtle">
                    <span>{c._count.messages} messages</span>
                    {c.pagePath && <span>· from {c.pagePath}</span>}
                    {c._count.leads > 0 && <Badge tone="success">became a lead</Badge>}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          <div>
            {!open ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-line p-12">
                <p className="text-sm text-muted">Pick a conversation to read it.</p>
              </div>
            ) : (
              <div className="rounded-lg border border-line bg-surface p-5">
                <h2 className="font-display text-lg font-semibold text-ink">{open.title ?? 'Conversation'}</h2>
                <ul className="mt-5 space-y-4">
                  {open.messages.map((m) => (
                    <li key={m.id}>
                      <p className="font-mono text-2xs uppercase tracking-wide text-subtle">{m.role}</p>
                      <p className={clsx('mt-1 whitespace-pre-wrap text-sm leading-relaxed', m.role === 'user' ? 'text-ink' : 'text-muted')}>
                        {m.content}
                      </p>
                      {m.toolCalls?.length > 0 && (
                        <p className="mt-1.5 font-mono text-2xs text-accent">
                          tools: {m.toolCalls.map((t) => t.name).join(', ')}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </AdminPage>
  );
}

// ── Sakha tuning ──────────────────────────────────────────────────────────────

export function SakhaSettings() {
  const [settings, setSettings] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [tools, setTools] = useState(new Set());
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get('/sakha/admin/settings')
      .then((s) => {
        setSettings(s);
        setPrompt(s.systemPrompt);
        setTools(new Set(s.enabledTools));
      })
      .catch((e) => setStatus({ tone: 'error', message: e.message }));
  }, []);

  async function save() {
    setBusy(true);
    try {
      await api.put('/sakha/admin/settings', { systemPrompt: prompt, enabledTools: [...tools] });
      setStatus({ tone: 'success', message: 'Saved. It applies to the next conversation turn.' });
    } catch (err) {
      setStatus({ tone: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage
      title="Tuning Sakha"
      description="Her instructions and the actions she is allowed to take. Changes apply on the next turn, with no deploy."
      actions={<Button size="sm" variant="accent" onClick={save} loading={busy} disabled={!settings}>Save</Button>}
    >
      {status && (
        <Alert tone={status.tone === 'error' ? 'error' : 'success'} className="mb-6">
          {status.message}
        </Alert>
      )}

      {!settings ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
          <div>
            <Field
              label="System prompt"
              hint="What Sakha is told before every conversation. Be careful: this is the whole of her judgement about what to say and what to refuse."
            >
              <Textarea
                rows={26}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="font-mono text-xs leading-relaxed"
              />
            </Field>
            <button
              type="button"
              onClick={() => setPrompt(settings.defaultSystemPrompt)}
              className="mt-2 text-xs text-muted underline-offset-2 hover:text-accent hover:underline"
            >
              Restore the shipped default
            </button>
          </div>

          <div className="space-y-6">
            <div className="card p-5">
              <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">Model</p>
              <p className="mt-2 font-mono text-sm text-ink">{settings.model}</p>
              <Badge tone={settings.configured ? 'success' : 'danger'} className="mt-3">
                {settings.configured ? 'connected' : 'no API key'}
              </Badge>
            </div>

            <div className="card p-5">
              <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
                Tools she may use
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                A tool she is not given is one she cannot misuse. Turning off{' '}
                <code className="font-mono">capture_lead</code> stops her passing anyone to a founder.
              </p>
              <div className="mt-4 space-y-2.5">
                {settings.availableTools.map((t) => (
                  <label key={t} className="flex items-center gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={tools.has(t)}
                      onChange={() =>
                        setTools((prev) => {
                          const next = new Set(prev);
                          if (next.has(t)) next.delete(t);
                          else next.add(t);
                          return next;
                        })
                      }
                      className="h-4 w-4 rounded border-line text-accent"
                    />
                    <code className="font-mono text-xs text-muted">{t}</code>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminPage>
  );
}

// ── CMS pages ─────────────────────────────────────────────────────────────────

export function Pages() {
  const canWrite = useSelector(selectCan('cms.content.write'));
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setData(await api.get('/content/admin/pages?limit=100')), []);

  useEffect(() => {
    load().catch((e) => setStatus({ tone: 'error', message: e.message }));
  }, [load]);

  const blank = {
    slug: '',
    kind: 'industry',
    title: '',
    summary: '',
    status: 'draft',
    data: { headline: '', workflow: '', metric: '', objection: '', objectionAnswer: '' },
  };

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing.id) await api.put(`/content/admin/pages/${editing.id}`, stripMeta(editing));
      else await api.post('/content/admin/pages', stripMeta(editing));
      setEditing(null);
      await load();
      setStatus({ tone: 'success', message: 'Saved. Published pages appear on the site and in Sakha immediately.' });
    } catch (err) {
      setStatus({ tone: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function remove(page) {
    setBusy(true);
    try {
      await api.delete(`/content/admin/pages/${page.id}`);
      await load();
      setStatus({ tone: 'success', message: `Deleted “${page.title}”.` });
    } catch (err) {
      setStatus({ tone: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage
      title="Pages"
      description="Industry pages, extra case studies and posts. Publishing one puts it on the site and into Sakha's knowledge without a deploy."
      actions={canWrite && <Button size="sm" variant="outline" onClick={() => setEditing(blank)}>New page</Button>}
    >
      {status && (
        <Alert tone={status.tone === 'error' ? 'error' : 'success'} className="mb-6">
          {status.message}
        </Alert>
      )}

      {editing && (
        <form onSubmit={save} className="mb-8 space-y-5 rounded-lg border border-accent/30 bg-accent-soft/25 p-6">
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Kind" className="sm:col-span-1">
              <Select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value })}>
                <option value="industry">Industry</option>
                <option value="case_study">Case study</option>
                <option value="post">Post</option>
                <option value="page">Page</option>
              </Select>
            </Field>
            <Field label="Title" required className="sm:col-span-2">
              <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} required />
            </Field>
            <Field label="Status">
              <Select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </Select>
            </Field>
          </div>

          <Field label="Slug" required hint="Lowercase, hyphens only. Becomes part of the URL.">
            <Input
              value={editing.slug}
              onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
              placeholder="dental-clinics"
              required
            />
          </Field>

          <Field label="Summary">
            <Textarea rows={2} value={editing.summary ?? ''} onChange={(e) => setEditing({ ...editing, summary: e.target.value })} />
          </Field>

          {editing.kind === 'industry' && (
            <div className="grid gap-4 sm:grid-cols-2">
              {['headline', 'workflow', 'metric', 'objection', 'objectionAnswer'].map((key) => (
                <Field key={key} label={key.replace(/([A-Z])/g, ' $1')} className={key === 'objectionAnswer' ? 'sm:col-span-2' : ''}>
                  <Input
                    value={editing.data?.[key] ?? ''}
                    onChange={(e) => setEditing({ ...editing, data: { ...editing.data, [key]: e.target.value } })}
                  />
                </Field>
              ))}
            </div>
          )}

          <Field label="Body" hint="Markdown. Indexed into Sakha's knowledge when published.">
            <Textarea rows={8} value={editing.body ?? ''} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
          </Field>

          <div className="flex gap-2">
            <Button type="submit" variant="accent" loading={busy}>Save</Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      )}

      {!data ? (
        <Skeleton className="h-64" />
      ) : data.items.length === 0 ? (
        <EmptyState
          title="No extra pages yet."
          body="Industry pages added here appear in the navigation automatically."
          action={canWrite && <Button variant="accent" onClick={() => setEditing(blank)}>Add the first one</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-raised">
              <tr className="text-left text-2xs uppercase tracking-wide text-subtle">
                <th className="px-4 py-2.5 font-semibold">Title</th>
                <th className="px-4 py-2.5 font-semibold">Kind</th>
                <th className="px-4 py-2.5 font-semibold">Slug</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.items.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-medium text-ink">{p.title}</td>
                  <td className="px-4 py-3 text-muted">{p.kind}</td>
                  <td className="px-4 py-3">
                    <code className="font-mono text-xs text-subtle">{p.slug}</code>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={p.status === 'published' ? 'success' : 'neutral'}>{p.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canWrite && (
                      <span className="flex justify-end gap-2">
                        <button type="button" onClick={() => setEditing(p)} className="text-xs text-accent hover:underline">
                          Edit
                        </button>
                        <button type="button" onClick={() => remove(p)} className="text-xs text-danger hover:underline">
                          Delete
                        </button>
                      </span>
                    )}
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

/** Strip server-managed fields before sending a page back for save. */
const stripMeta = ({
  id: _id,
  createdAt: _createdAt,
  updatedAt: _updatedAt,
  author: _author,
  authorId: _authorId,
  publishedAt: _publishedAt,
  ...rest
}) => rest;

// ── Media ─────────────────────────────────────────────────────────────────────

export function Media() {
  const canWrite = useSelector(selectCan('cms.media.write'));
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setData(await api.get('/media?limit=60')), []);

  useEffect(() => {
    load().catch((e) => setStatus({ tone: 'error', message: e.message }));
  }, [load]);

  async function upload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await api.post('/media', form);
      await load();
      setStatus({ tone: 'success', message: 'Uploaded.' });
    } catch (err) {
      setStatus({ tone: 'error', message: err.message });
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  return (
    <AdminPage
      title="Media"
      description="Images and PDFs used across the site. Reference a file by its URL in the content editor."
      actions={
        canWrite && (
          <label className="inline-flex h-8 cursor-pointer items-center rounded border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-raised">
            {busy ? 'Uploading…' : 'Upload'}
            <input type="file" className="sr-only" onChange={upload} accept="image/*,application/pdf" />
          </label>
        )
      }
    >
      {status && (
        <Alert tone={status.tone === 'error' ? 'error' : 'success'} className="mb-6">
          {status.message}
        </Alert>
      )}

      {!data ? (
        <Skeleton className="h-64" />
      ) : data.items.length === 0 ? (
        <EmptyState title="Nothing uploaded yet." body="Team photos and case-study images go here." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {data.items.map((m) => (
            <li key={m.id} className="overflow-hidden rounded-lg border border-line bg-surface">
              {m.mimeType.startsWith('image/') ? (
                <img src={m.url} alt={m.alt ?? m.originalName} className="aspect-square w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex aspect-square items-center justify-center bg-raised text-xs text-subtle">PDF</div>
              )}
              <div className="p-2.5">
                <p className="truncate text-xs text-ink" title={m.originalName}>{m.originalName}</p>
                <p className="text-2xs text-subtle">{(m.size / 1024).toFixed(0)} KB</p>
                <code className="mt-1 block truncate font-mono text-2xs text-subtle">{m.url}</code>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AdminPage>
  );
}

function Tile({ label, value, note, tone = 'neutral' }) {
  return (
    <div className={clsx('card p-5', tone === 'warning' && 'border-warning/30 bg-warning/5')}>
      <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">{label}</p>
      <p className="mt-2.5 font-display text-2xl font-semibold text-ink">{value}</p>
      {note && <p className="mt-1 text-xs text-subtle">{note}</p>}
    </div>
  );
}
