import clsx from 'clsx';

export const STATUS_LABEL = { open: 'Open', pending: 'Waiting on client', resolved: 'Resolved', closed: 'Closed' };
export const CLIENT_STATUS_LABEL = { ...STATUS_LABEL, pending: 'Waiting on you' };
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const CATEGORIES = ['question', 'bug', 'change', 'access', 'billing', 'other'];

const STATUS_TONE = {
  open: 'border-accent/25 bg-accent-soft text-accent',
  pending: 'border-keystone/25 bg-keystone/10 text-keystone',
  resolved: 'border-trust/25 bg-trust-soft text-trust',
  closed: 'border-line bg-raised text-subtle',
};

export function StatusPill({ status, labels = STATUS_LABEL }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-2xs uppercase tracking-[0.12em]',
        STATUS_TONE[status] ?? STATUS_TONE.closed
      )}
    >
      {labels[status] ?? status}
    </span>
  );
}

export function PriorityMark({ priority }) {
  if (priority === 'normal' || !priority) return null;
  return (
    <span
      className={clsx(
        'font-mono text-2xs uppercase tracking-[0.12em]',
        priority === 'urgent' ? 'text-danger' : priority === 'high' ? 'text-keystone' : 'text-subtle'
      )}
    >
      {priority}
    </span>
  );
}

const AUTHOR_LABEL = { client: null, staff: 'Asphalix', sakha: 'Sakha', system: 'System' };

/** One message in a ticket thread. Internal notes get a dashed keystone frame. */
export function ThreadMessage({ message, viewer = 'client' }) {
  const mine = viewer === 'client' ? message.authorType === 'client' : message.authorType === 'staff';
  const who = message.author?.name ?? AUTHOR_LABEL[message.authorType] ?? message.authorType;
  return (
    <li
      className={clsx(
        'rounded-lg border p-4',
        message.internal
          ? 'border-dashed border-keystone/50 bg-keystone/5'
          : mine
            ? 'border-line bg-surface'
            : 'border-line border-l-[3px] border-l-trust bg-paper'
      )}
    >
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-subtle">
        <span className="font-medium text-ink">{who}</span>
        {message.authorType !== 'client' && message.author?.name && (
          <span className="font-mono uppercase tracking-[0.12em]">{AUTHOR_LABEL[message.authorType]}</span>
        )}
        {message.internal && <span className="font-mono uppercase tracking-[0.12em] text-keystone">Internal note</span>}
        <time className="ml-auto" dateTime={message.createdAt}>
          {new Date(message.createdAt).toLocaleString()}
        </time>
      </p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">{message.body}</p>
    </li>
  );
}
