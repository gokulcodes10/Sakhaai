/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  The CMS.
 * ─────────────────────────────────────────────────────────────────────────────
 *  The editor walks the content JSON and renders a field for every editable
 *  leaf, so it needs no per-page schema: add a key to site-content.json and it
 *  becomes editable here automatically. Keys prefixed with `_` are treated as
 *  editorial notes and shown as guidance rather than as fields, which is how the
 *  content file carries its own instructions to whoever is editing it.
 *
 *  Draft and live are separate. Nothing a person types is public until they
 *  press Publish, and Publish is what triggers Sakha's re-index.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import clsx from 'clsx';
import api from '../../lib/api.js';
import { selectCan } from '../../features/auth/authSlice.js';
import { AdminPage } from '../../components/layout/AdminLayout.jsx';
import { Alert, Button, Input, Textarea, Badge, Skeleton } from '../../components/ui/index.jsx';

const HIDDEN_KEYS = new Set(['$schema', '_meta']);

export default function ContentEditor() {
  const canWrite = useSelector(selectCan('cms.content.write'));
  const canPublish = useSelector(selectCan('cms.content.publish'));

  const [draft, setDraft] = useState(null);
  const [changes, setChanges] = useState([]);
  const [dirty, setDirty] = useState({});
  const [activeSection, setActiveSection] = useState(null);
  const [status, setStatus] = useState({ tone: null, message: null });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api.get('/content/draft');
    setDraft(res.draft);
    setChanges(res.changes ?? []);
    setActiveSection((cur) => cur ?? Object.keys(res.draft).filter((k) => !HIDDEN_KEYS.has(k))[0]);
  }, []);

  useEffect(() => {
    load().catch((err) => setStatus({ tone: 'error', message: err.message }));
  }, [load]);

  const sections = useMemo(
    () => (draft ? Object.keys(draft).filter((k) => !HIDDEN_KEYS.has(k) && !k.startsWith('_')) : []),
    [draft]
  );

  const stage = (path, value) => setDirty((d) => ({ ...d, [path]: value }));

  async function save() {
    const entries = Object.entries(dirty);
    if (!entries.length) return;
    setBusy(true);
    setStatus({ tone: null, message: null });
    try {
      await api.patch('/content/draft', {
        changes: entries.map(([path, value]) => ({ path, value })),
      });
      setDirty({});
      await load();
      setStatus({ tone: 'success', message: 'Draft saved. Nothing is public until you publish.' });
    } catch (err) {
      setStatus({ tone: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    try {
      const res = await api.post('/content/publish', {});
      await load();
      setStatus({ tone: 'success', message: `${res.message} (revision ${res.version})` });
    } catch (err) {
      setStatus({ tone: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    setBusy(true);
    try {
      await api.post('/content/draft/reset', {});
      setDirty({});
      await load();
      setStatus({ tone: 'success', message: 'Draft reset to what is currently live.' });
    } catch (err) {
      setStatus({ tone: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  const unsaved = Object.keys(dirty).length;

  return (
    <AdminPage
      title="Site content"
      description="Every word on the public site. Edits are saved as a draft; publishing makes them live and rebuilds Sakha's knowledge."
      actions={
        <>
          {changes.length > 0 && <Badge tone="warning">{changes.length} unpublished</Badge>}
          {unsaved > 0 && <Badge tone="accent">{unsaved} unsaved</Badge>}
          {canWrite && (
            <Button variant="outline" size="sm" onClick={save} disabled={!unsaved} loading={busy}>
              Save draft
            </Button>
          )}
          {canPublish && (
            <Button variant="accent" size="sm" onClick={publish} disabled={busy || (!changes.length && !unsaved)}>
              Publish
            </Button>
          )}
        </>
      }
    >
      {status.message && (
        <Alert tone={status.tone === 'error' ? 'error' : 'success'} className="mb-6">
          {status.message}
        </Alert>
      )}

      {!canWrite && (
        <Alert tone="info" className="mb-6">
          You have read-only access to content. Ask a super admin for{' '}
          <code className="font-mono text-xs">cms.content.write</code> to make changes.
        </Alert>
      )}

      {!draft ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[13rem_1fr]">
          <nav className="lg:sticky lg:top-6 lg:self-start">
            <ul className="space-y-0.5">
              {sections.map((key) => {
                const pending = changes.filter((c) => c.path.startsWith(`${key}.`)).length;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => setActiveSection(key)}
                      className={clsx(
                        'flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm capitalize transition-colors',
                        activeSection === key ? 'bg-raised font-medium text-ink' : 'text-muted hover:bg-raised/60'
                      )}
                    >
                      {humanise(key)}
                      {pending > 0 && (
                        <span className="ml-2 rounded-full bg-accent px-1.5 text-2xs font-semibold text-accent-ink">
                          {pending}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            {changes.length > 0 && canWrite && (
              <button
                type="button"
                onClick={discard}
                className="mt-6 w-full rounded px-3 py-2 text-left text-xs text-danger transition-colors hover:bg-danger/5"
              >
                Discard all unpublished changes
              </button>
            )}
          </nav>

          <div className="min-w-0">
            {activeSection && (
              <Node
                value={draft[activeSection]}
                path={activeSection}
                dirty={dirty}
                onChange={stage}
                readOnly={!canWrite}
                depth={0}
              />
            )}
          </div>
        </div>
      )}
    </AdminPage>
  );
}

/**
 * Recursive renderer. Objects become nested groups, arrays become numbered
 * cards, and primitives become inputs — chosen by value shape, so a new field in
 * the JSON needs no code here.
 */
function Node({ value, path, dirty, onChange, readOnly, depth, label }) {
  // Editorial guidance lives alongside the content it describes.
  const note = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.entries(value).find(([k]) => k.startsWith('_') && k.endsWith('Note'))?.[1]
    : null;

  if (value === null || value === undefined) return null;

  if (Array.isArray(value)) {
    return (
      <section className={clsx(depth > 0 && 'mt-6')}>
        {label && <GroupLabel depth={depth}>{label}</GroupLabel>}
        <div className="space-y-4">
          {value.map((item, i) => (
            <div key={i} className="rounded-lg border border-line bg-surface p-5">
              <p className="mb-4 font-mono text-2xs uppercase tracking-wide text-subtle">
                {label ? `${humanise(label)} ${i + 1}` : `Item ${i + 1}`}
                {item?.name && ` — ${item.name}`}
                {item?.title && ` — ${item.title}`}
                {item?.label && ` — ${item.label}`}
              </p>
              <Node
                value={item}
                path={`${path}.${i}`}
                dirty={dirty}
                onChange={onChange}
                readOnly={readOnly}
                depth={depth + 1}
              />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => !k.startsWith('_') && !k.startsWith('$'));
    return (
      <section className={clsx(depth > 0 && 'mt-6', depth === 0 && 'space-y-6')}>
        {label && <GroupLabel depth={depth}>{label}</GroupLabel>}
        {note && (
          <p className="mb-4 rounded-md border border-warning/25 bg-warning/5 px-3.5 py-2.5 text-xs leading-relaxed text-warning">
            {note}
          </p>
        )}
        <div className={clsx(depth === 0 ? 'space-y-6' : 'space-y-4')}>
          {keys.map((key) => (
            <Node
              key={key}
              value={value[key]}
              path={`${path}.${key}`}
              label={key}
              dirty={dirty}
              onChange={onChange}
              readOnly={readOnly}
              depth={depth + 1}
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <LeafField
      path={path}
      label={label}
      value={value}
      dirty={dirty}
      onChange={onChange}
      readOnly={readOnly}
    />
  );
}

function LeafField({ path, label, value, dirty, onChange, readOnly }) {
  const staged = Object.prototype.hasOwnProperty.call(dirty, path);
  const current = staged ? dirty[path] : value;

  if (typeof value === 'boolean') {
    return (
      <label className="flex items-center gap-2.5">
        <input
          type="checkbox"
          checked={Boolean(current)}
          disabled={readOnly}
          onChange={(e) => onChange(path, e.target.checked)}
          className="h-4 w-4 rounded border-line text-accent"
        />
        <span className="text-sm font-medium text-ink">{humanise(label)}</span>
        {staged && <Badge tone="accent">edited</Badge>}
      </label>
    );
  }

  if (typeof value === 'number') {
    return (
      <div className="space-y-1.5">
        <FieldLabel label={label} path={path} staged={staged} />
        <Input
          type="number"
          value={current}
          disabled={readOnly}
          onChange={(e) => onChange(path, Number(e.target.value))}
          className="max-w-xs"
        />
      </div>
    );
  }

  const long = typeof value === 'string' && (value.length > 110 || value.includes('\n'));

  return (
    <div className="space-y-1.5">
      <FieldLabel label={label} path={path} staged={staged} />
      {long ? (
        <Textarea
          value={current ?? ''}
          disabled={readOnly}
          rows={Math.min(10, Math.ceil(String(current ?? '').length / 90) + 2)}
          onChange={(e) => onChange(path, e.target.value)}
        />
      ) : (
        <Input value={current ?? ''} disabled={readOnly} onChange={(e) => onChange(path, e.target.value)} />
      )}
    </div>
  );
}

function FieldLabel({ label, path, staged }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <label className="text-sm font-medium text-ink">{humanise(label)}</label>
      <span className="flex items-center gap-2">
        {staged && <Badge tone="accent">edited</Badge>}
        <code className="font-mono text-2xs text-subtle">{path}</code>
      </span>
    </div>
  );
}

function GroupLabel({ depth, children }) {
  if (depth === 1) {
    return (
      <h2 className="mb-3 border-b border-line pb-2 font-display text-lg font-semibold text-ink">
        {humanise(children)}
      </h2>
    );
  }
  return (
    <h3 className="mb-2 text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
      {humanise(children)}
    </h3>
  );
}

function humanise(key) {
  return String(key)
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}
