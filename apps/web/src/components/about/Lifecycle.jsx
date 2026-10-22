import { useId, useRef, useState } from 'react';
import clsx from 'clsx';
import { Badge } from '../ui/index.jsx';

const SOURCE_TONES = { lor: 'trust', role: 'keystone', site: 'accent' };

/**
 * The engineering lifecycle as a chain of stages, each opening to its evidence.
 *
 * A tag cloud is a claim; this is meant to be a ledger. Every line under a
 * stage carries the source it came from, so a visitor can see what is vouched
 * for by someone else, what is the current job, and what they can poke at on
 * this very site. `compact` (the About card) shows the stage summary only and
 * leaves the evidence to the profile page.
 */
export default function Lifecycle({ stages, sources = {}, compact = false }) {
  const [active, setActive] = useState(0);
  const tabs = useRef([]);
  const id = useId();
  const stage = stages[active];

  const onKeyDown = (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    let next = step === undefined ? null : (active + step + stages.length) % stages.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = stages.length - 1;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label="Engineering lifecycle"
        onKeyDown={onKeyDown}
        className="relative grid grid-cols-3 gap-y-5 sm:grid-cols-6"
      >
        {/* The thread through the stages: centred on the 40px nodes. */}
        <span aria-hidden="true" className="absolute inset-x-[8%] top-5 hidden h-px bg-line sm:block" />
        {stages.map((s, i) => (
          <button
            key={s.key}
            ref={(el) => (tabs.current[i] = el)}
            type="button"
            role="tab"
            id={`${id}-tab-${s.key}`}
            aria-selected={i === active}
            aria-controls={`${id}-panel`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            className="group relative flex flex-col items-center gap-2 text-center focus-visible:outline-none"
          >
            <span
              className={clsx(
                'flex h-10 w-10 items-center justify-center rounded-full border font-mono text-xs transition-colors group-focus-visible:ring-2 group-focus-visible:ring-accent group-focus-visible:ring-offset-2',
                i === active
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-line bg-paper text-muted group-hover:border-ink group-hover:text-ink'
              )}
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className={clsx('px-1 text-xs font-medium leading-tight', i === active ? 'text-ink' : 'text-muted')}>
              {s.label}
            </span>
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${stage.key}`}
        className={clsx('rounded-lg border border-line bg-surface', compact ? 'mt-5 p-5' : 'mt-8 p-6 sm:p-8')}
      >
        <p className="font-mono text-2xs uppercase tracking-wider text-subtle">{stage.label}</p>
        <p className={clsx('mt-2 text-ink', compact ? 'text-base' : 'font-display text-xl leading-snug')}>
          {stage.summary}
        </p>
        {!compact && stage.evidence?.length > 0 && (
          <ul className="mt-6 space-y-4 border-t border-line pt-6">
            {stage.evidence.map((ev) => (
              <li key={ev.text} className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
                <Badge tone={SOURCE_TONES[ev.source] ?? 'neutral'} className="shrink-0 self-start sm:mt-0.5">
                  {sources[ev.source] ?? ev.source}
                </Badge>
                <span className="leading-relaxed text-muted">{ev.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
