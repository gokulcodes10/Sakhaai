/**
 * People & Access.
 *
 * This screen is the brief's central requirement made concrete: the super admin
 * picks a person, ticks the CMS boxes, and that person has CMS access on their
 * very next request. Permissions the actor does not hold themselves are
 * rendered disabled — the server refuses them too, but showing a tickable box
 * that will fail is a worse experience than showing why it cannot be ticked.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import clsx from 'clsx';
import api from '../../lib/api.js';
import { selectCan, selectUser } from '../../features/auth/authSlice.js';
import { AdminPage } from '../../components/layout/AdminLayout.jsx';
import { Alert, Badge, Button, Checkbox, Field, Input, Select, Skeleton } from '../../components/ui/index.jsx';

export default function People() {
  const me = useSelector(selectUser);
  const canGrant = useSelector(selectCan('iam.grant'));
  const canWrite = useSelector(selectCan('iam.users.write'));

  const [users, setUsers] = useState(null);
  const [roles, setRoles] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [selected, setSelected] = useState(null);
  const [grants, setGrants] = useState(new Set());
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const [u, r, p] = await Promise.all([
      api.get('/iam/users?limit=100'),
      api.get('/iam/roles'),
      api.get('/iam/permissions'),
    ]);
    setUsers(u.items);
    setRoles(r.roles);
    setCatalogue(p.catalogue);
    return u.items;
  }, []);

  useEffect(() => {
    load().catch((err) => setStatus({ tone: 'error', message: err.message }));
  }, [load]);

  function pick(user) {
    setSelected(user);
    setGrants(new Set(user.directGrants ?? []));
    setStatus(null);
  }

  async function saveGrants() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await api.put(`/iam/users/${selected.id}/grants`, {
        permissions: [...grants],
      });
      const fresh = await load();
      const updated = fresh.find((u) => u.id === selected.id);
      if (updated) pick(updated);
      setStatus({
        tone: 'success',
        message:
          res.added.length || res.removed.length
            ? `${res.message}${res.added.length ? ` Added: ${res.added.join(', ')}.` : ''}${res.removed.length ? ` Removed: ${res.removed.join(', ')}.` : ''}`
            : 'No changes.',
      });
    } catch (err) {
      setStatus({ tone: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function setUserRoles(user, roleKey) {
    setBusy(true);
    try {
      await api.put(`/iam/users/${user.id}/roles`, { roleKeys: [roleKey] });
      const fresh = await load();
      const updated = fresh.find((u) => u.id === user.id);
      if (updated && selected?.id === user.id) pick(updated);
      setStatus({ tone: 'success', message: `${user.name} is now ${roleKey.replace('_', ' ')}.` });
    } catch (err) {
      setStatus({ tone: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  const toggleGrant = (key) =>
    setGrants((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** Tick or clear a whole domain at once — the common case is "give them CMS". */
  const toggleDomain = (group, on) =>
    setGrants((prev) => {
      const next = new Set(prev);
      for (const p of group.permissions) {
        if (!p.grantable) continue;
        if (on) next.add(p.key);
        else next.delete(p.key);
      }
      return next;
    });

  return (
    <AdminPage
      title="People & access"
      description="Roles set the baseline. Direct grants give one person something extra — that is how you hand the CMS to a specific admin without promoting everyone."
      actions={canWrite && <Button size="sm" variant="outline" onClick={() => setCreating(true)}>Add someone</Button>}
    >
      {status && (
        <Alert tone={status.tone === 'error' ? 'error' : 'success'} className="mb-6">
          {status.message}
        </Alert>
      )}

      {creating && (
        <CreateUser
          roles={roles}
          onClose={() => setCreating(false)}
          onCreated={async (msg) => {
            setCreating(false);
            await load();
            setStatus({ tone: 'success', message: msg });
          }}
        />
      )}

      {!users ? (
        <Skeleton className="h-80" />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <p className="mb-3 text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
              {users.length} {users.length === 1 ? 'person' : 'people'}
            </p>
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
              {users.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => pick(u)}
                    className={clsx(
                      'flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors',
                      selected?.id === u.id ? 'bg-accent-soft' : 'hover:bg-raised'
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-semibold text-accent">
                      {u.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink">{u.name}</span>
                        {u.id === me?.id && <Badge>you</Badge>}
                      </span>
                      <span className="block truncate text-xs text-subtle">{u.title ?? u.email}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      {u.roles.map((r) => (
                        <Badge key={r.key} tone={r.key === 'super_admin' ? 'accent' : 'neutral'}>
                          {r.name}
                        </Badge>
                      ))}
                      {u.directGrants?.length > 0 && (
                        <span className="text-2xs text-accent">+{u.directGrants.length} direct</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            {!selected ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-line p-12 text-center">
                <p className="text-sm text-muted">Pick someone to see and change what they can do.</p>
              </div>
            ) : (
              <div className="rounded-lg border border-line bg-surface">
                <div className="border-b border-line p-5">
                  <h2 className="font-display text-lg font-semibold text-ink">{selected.name}</h2>
                  <p className="mt-0.5 text-sm text-muted">{selected.email}</p>

                  <div className="mt-4">
                    <Field label="Role">
                      <Select
                        value={selected.roles[0]?.key ?? ''}
                        disabled={!canWrite || selected.id === me?.id}
                        onChange={(e) => setUserRoles(selected, e.target.value)}
                        className="max-w-xs"
                      >
                        {roles.map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {selected.id === me?.id && (
                      <p className="mt-1.5 text-xs text-subtle">You cannot change your own role.</p>
                    )}
                  </div>
                </div>

                <div className="p-5">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-ink">Direct permissions</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted">
                        Granted to {selected.name.split(' ')[0]} on top of their role. Takes effect
                        immediately — no sign-out needed.
                      </p>
                    </div>
                    {canGrant && (
                      <Button size="sm" variant="accent" onClick={saveGrants} loading={busy}>
                        Save
                      </Button>
                    )}
                  </div>

                  {!canGrant && (
                    <Alert tone="info" className="mb-4">
                      You need <code className="font-mono text-xs">iam.grant</code> to change these.
                    </Alert>
                  )}

                  <div className="space-y-5">
                    {catalogue.map((group) => {
                      const grantableKeys = group.permissions.filter((p) => p.grantable).map((p) => p.key);
                      const allOn = grantableKeys.length > 0 && grantableKeys.every((k) => grants.has(k));

                      return (
                        <fieldset key={group.domain} className="rounded-md border border-line p-4">
                          <legend className="flex items-center gap-3 px-1.5">
                            <span className="text-sm font-semibold text-ink">{group.label}</span>
                            {canGrant && grantableKeys.length > 0 && (
                              <button
                                type="button"
                                onClick={() => toggleDomain(group, !allOn)}
                                className="text-2xs font-medium text-accent hover:underline"
                              >
                                {allOn ? 'clear all' : 'grant all'}
                              </button>
                            )}
                          </legend>

                          {group.description && (
                            <p className="mb-3 text-xs text-subtle">{group.description}</p>
                          )}

                          <div className="space-y-2.5">
                            {group.permissions.map((p) => (
                              <Checkbox
                                key={p.key}
                                label={p.label}
                                description={p.description ?? undefined}
                                checked={grants.has(p.key)}
                                disabled={!canGrant || !p.grantable}
                                onChange={() => toggleGrant(p.key)}
                              />
                            ))}
                          </div>
                        </fieldset>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AdminPage>
  );
}

function CreateUser({ roles, onClose, onCreated }) {
  const [values, setValues] = useState({ name: '', email: '', title: '', roleKey: 'employee' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/iam/users', {
        name: values.name,
        email: values.email,
        title: values.title || undefined,
        roleKeys: [values.roleKey],
      });
      onCreated(`${values.name} added. ${res.note ?? ''}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-accent/30 bg-accent-soft/30 p-6">
      <h2 className="font-display text-lg font-semibold text-ink">Add someone</h2>
      <p className="mt-1 text-sm text-muted">
        They will be created without a password and must use “Forgot password” to set one.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <Input value={values.name} onChange={set('name')} required />
          </Field>
          <Field label="Email" required>
            <Input type="email" value={values.email} onChange={set('email')} required />
          </Field>
          <Field label="Job title">
            <Input value={values.title} onChange={set('title')} />
          </Field>
          <Field label="Role" required>
            <Select value={values.roleKey} onChange={set('roleKey')}>
              {roles
                .filter((r) => r.key !== 'super_admin')
                .map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="accent" loading={busy}>
            Create
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
