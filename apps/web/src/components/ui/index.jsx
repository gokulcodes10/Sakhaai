/**
 * UI primitives. Deliberately small and unopinionated — the design lives in the
 * tokens, not in a component library, so a token change restyles everything.
 */

import { forwardRef } from 'react';
import { Link } from 'react-router';
import clsx from 'clsx';

// ── Hues ──────────────────────────────────────────────────────────────────────
// The four brand hues each carry a fixed meaning (Identity Kit v2). Class names
// are spelled out in full so Tailwind's scanner keeps them.

export const HUES = {
  accent: { text: 'text-accent', bg: 'bg-accent', border: 'border-accent' },
  trust: { text: 'text-trust', bg: 'bg-trust', border: 'border-trust' },
  keystone: { text: 'text-keystone', bg: 'bg-keystone', border: 'border-keystone' },
  iris: { text: 'text-iris', bg: 'bg-iris', border: 'border-iris' },
};

/** Mono section label with the 22×2 lead-in bar, coloured by hue. */
export function Eyebrow({ hue = 'keystone', className, children }) {
  return <p className={clsx('eyebrow', HUES[hue]?.text, className)}>{children}</p>;
}

// ── Button ────────────────────────────────────────────────────────────────────

const BUTTON_VARIANTS = {
  primary:
    'bg-ink text-paper hover:bg-ink/85 active:bg-ink disabled:bg-ink/40',
  accent:
    'bg-accent text-accent-ink hover:bg-accent/85 active:bg-accent disabled:bg-accent/40',
  outline:
    'border border-line bg-surface text-ink hover:border-ink disabled:opacity-50',
  ghost: 'text-muted hover:text-ink hover:bg-raised disabled:opacity-50',
  danger: 'bg-danger text-white hover:bg-danger/90 disabled:bg-danger/40',
  trust: 'bg-trust text-white hover:bg-trust/90 disabled:bg-trust/40',
  // No colours: the caller supplies them (e.g. fixed-dark bands that ignore the theme).
  bare: 'disabled:opacity-50',
};

const BUTTON_SIZES = {
  sm: 'h-9 px-3.5 text-sm gap-1.5 rounded-sm',
  md: 'h-11 px-4 text-sm gap-2 rounded',
  lg: 'h-[50px] px-6 text-base gap-2 rounded',
};

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', className, as, to, href, loading, children, ...props },
  ref
) {
  const classes = clsx(
    'inline-flex items-center justify-center font-medium transition-colors duration-150',
    'disabled:cursor-not-allowed select-none whitespace-nowrap',
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    className
  );

  const content = (
    <>
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </>
  );

  if (to) {
    return (
      <Link ref={ref} to={to} className={classes} {...props}>
        {content}
      </Link>
    );
  }
  if (href) {
    return (
      <a ref={ref} href={href} className={classes} {...props}>
        {content}
      </a>
    );
  }

  const Tag = as ?? 'button';
  return (
    <Tag ref={ref} className={classes} disabled={props.disabled || loading} {...props}>
      {content}
    </Tag>
  );
});

// ── Spinner ───────────────────────────────────────────────────────────────────

export function Spinner({ className }) {
  return (
    <svg className={clsx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// ── Form fields ───────────────────────────────────────────────────────────────

export function Field({ label, hint, error, required, children, className }) {
  return (
    <div className={clsx('space-y-1.5', className)}>
      {label && (
        <label className="block text-sm font-medium text-ink">
          {label}
          {required && <span className="ml-0.5 text-accent">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : (
        hint && <p className="text-sm text-subtle">{hint}</p>
      )}
    </div>
  );
}

const inputBase =
  'w-full rounded-md border bg-surface px-3 py-2.5 text-ink placeholder:text-subtle ' +
  'transition-colors focus:border-accent disabled:bg-raised disabled:text-muted';

export const Input = forwardRef(function Input({ className, error, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={clsx(inputBase, error ? 'border-danger' : 'border-line', className)}
      aria-invalid={error ? 'true' : undefined}
      {...props}
    />
  );
});

export const Textarea = forwardRef(function Textarea({ className, error, rows = 4, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={clsx(inputBase, 'resize-y leading-relaxed', error ? 'border-danger' : 'border-line', className)}
      aria-invalid={error ? 'true' : undefined}
      {...props}
    />
  );
});

export const Select = forwardRef(function Select({ className, error, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={clsx(inputBase, 'cursor-pointer pr-8', error ? 'border-danger' : 'border-line', className)}
      {...props}
    >
      {children}
    </select>
  );
});

export function Checkbox({ label, description, className, ...props }) {
  return (
    <label className={clsx('flex cursor-pointer items-start gap-2.5', className)}>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-line text-accent focus-visible:ring-accent"
        {...props}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-tight text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-snug text-subtle">{description}</span>}
      </span>
    </label>
  );
}

// ── Surfaces ──────────────────────────────────────────────────────────────────

/**
 * `hue` adds the 6px colour bar across the top; `inverted` is the dark
 * "recommended" card that sits in a row of light ones.
 */
export function Card({ className, children, hue, inverted, as: Tag = 'div', ...props }) {
  return (
    <Tag
      className={clsx(
        'card relative overflow-hidden p-6',
        inverted && 'border-ink bg-ink text-paper',
        hue && 'pt-8',
        className
      )}
      {...props}
    >
      {hue && <span aria-hidden="true" className={clsx('absolute inset-x-0 top-0 h-1.5', HUES[hue]?.bg)} />}
      {children}
    </Tag>
  );
}

export function Badge({ tone = 'neutral', className, children }) {
  const tones = {
    neutral: 'bg-raised text-muted border-line',
    accent: 'bg-accent-soft text-accent border-accent/20',
    trust: 'bg-trust-soft text-trust border-trust/20',
    keystone: 'bg-keystone/10 text-keystone border-keystone/20',
    iris: 'bg-iris/10 text-iris border-iris/20',
    success: 'bg-success/10 text-success border-success/20',
    danger: 'bg-danger/10 text-danger border-danger/20',
    warning: 'bg-warning/10 text-warning border-warning/20',
  };
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-2xs font-medium uppercase tracking-[0.12em]',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/** Section wrapper with a consistent vertical rhythm. */
export function Section({ className, children, tone = 'paper', id }) {
  const tones = {
    paper: 'bg-paper',
    surface: 'bg-surface',
    raised: 'bg-raised',
    ink: 'bg-ink text-paper',
    trust: 'bg-trust text-white',
  };
  return (
    <section id={id} className={clsx('py-18 sm:py-26', tones[tone], className)}>
      <div className="shell">{children}</div>
    </section>
  );
}

export function SectionHeading({ eyebrow, hue = 'keystone', title, body, align = 'left', className }) {
  return (
    <div
      className={clsx(
        'max-w-2xl',
        align === 'center' && 'mx-auto text-center',
        className
      )}
    >
      {eyebrow && <Eyebrow hue={hue} className="mb-4">{eyebrow}</Eyebrow>}
      {title && <h2 className="text-3xl leading-[1.08] sm:text-[2.875rem]">{title}</h2>}
      {body && <p className="mt-5 text-lg leading-relaxed text-muted">{body}</p>}
    </div>
  );
}

// ── Feedback ──────────────────────────────────────────────────────────────────

export function Alert({ tone = 'info', title, children, className }) {
  const tones = {
    info: 'border-line bg-raised text-muted',
    error: 'border-danger/30 bg-danger/5 text-danger',
    success: 'border-success/30 bg-success/5 text-success',
    warning: 'border-warning/30 bg-warning/5 text-warning',
  };
  return (
    <div className={clsx('rounded-md border px-4 py-3 text-sm', tones[tone], className)} role={tone === 'error' ? 'alert' : undefined}>
      {title && <p className="mb-0.5 font-semibold">{title}</p>}
      {children}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-16 text-center">
      {icon && <div className="mb-4 text-subtle">{icon}</div>}
      <p className="font-display text-xl font-semibold text-ink">{title}</p>
      {body && <p className="mt-2 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={clsx('animate-pulse rounded bg-raised', className)} aria-hidden="true" />;
}

/** Small labelled statistic, used on case studies and the admin dashboard. */
export function Stat({ label, value, note, tone = 'accent' }) {
  return (
    <div className="border-l-[3px] pl-4" style={{ borderColor: `rgb(var(--${tone}))` }}>
      <p className="font-display text-[2.125rem] font-semibold leading-none tracking-[-0.025em] text-ink">{value}</p>
      <p className="mt-2 text-sm font-medium text-ink">{label}</p>
      {note && <p className="mt-1 text-xs text-subtle">{note}</p>}
    </div>
  );
}
