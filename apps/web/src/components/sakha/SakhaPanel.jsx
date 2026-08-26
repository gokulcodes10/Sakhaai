/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  The Sakha panel.
 * ─────────────────────────────────────────────────────────────────────────────
 *  Deliberately NOT a chat bubble in the corner. It is a docked right-hand rail
 *  — the same affordance as a reference sidebar in an IDE — because the brief
 *  is for an intelligence surface that sits alongside the page, not a support
 *  widget that covers it. On a wide screen the page content shifts left rather
 *  than being overlaid, so you can read the pricing table and interrogate it at
 *  the same time.
 *
 *  Answers carry citations. That is the whole trust argument: Sakha shows you
 *  which page she got it from, and says she does not know when she does not.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useLocation } from 'react-router';
import clsx from 'clsx';
import {
  closePanel,
  dismissError,
  loadConversation,
  loadSakhaStatus,
  rateMessage,
  sendMessage,
  startNewConversation,
} from '../../features/sakha/sakhaSlice.js';
import { selectContent } from '../../features/content/contentSlice.js';
import { Button, Spinner } from '../ui/index.jsx';

export default function SakhaPanel() {
  const dispatch = useDispatch();
  const location = useLocation();
  const content = useSelector(selectContent);

  const {
    open,
    messages,
    pending,
    error,
    errorCode,
    available,
    knowledge,
    conversationId,
    ratings,
    retryText,
  } = useSelector((s) => s.sakha);

  const [draft, setDraft] = useState('');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const copy = content?.assistant ?? {};

  useEffect(() => {
    dispatch(loadSakhaStatus());
  }, [dispatch]);

  // Restore an in-progress thread on first open, so a reload does not lose it.
  useEffect(() => {
    if (open && conversationId && messages.length === 0) {
      dispatch(loadConversation(conversationId));
    }
  }, [open, conversationId, messages.length, dispatch]);

  useEffect(() => {
    if (retryText) setDraft(retryText);
  }, [retryText]);

  // Stick to the bottom as messages arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 260);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  // Escape closes the panel, matching every other dismissible surface.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') dispatch(closePanel());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dispatch]);

  const submit = useCallback(
    (text) => {
      const message = (text ?? draft).trim();
      if (!message || pending) return;
      setDraft('');
      dispatch(
        sendMessage({
          message,
          pageContext: { path: location.pathname, title: document.title },
        })
      );
    },
    [draft, pending, dispatch, location.pathname]
  );

  const suggestions = copy.emptyStateSuggestions ?? [];

  return (
    <>
      {/* Scrim on narrow screens only — on desktop the panel is docked, not modal. */}
      <div
        className={clsx(
          'fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={() => dispatch(closePanel())}
        aria-hidden="true"
      />

      <aside
        className={clsx(
          'fixed right-0 top-0 z-50 flex h-dvh w-full flex-col bg-surface shadow-panel',
          'transition-transform duration-300 ease-out sm:w-[400px]',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
        style={{ width: 'min(100vw, var(--panel-width))' }}
        aria-hidden={!open}
        aria-label="Sakha, the Sakha AI assistant"
      >
        <Header
          copy={copy}
          knowledge={knowledge}
          onClose={() => dispatch(closePanel())}
          onNew={() => dispatch(startNewConversation())}
          hasMessages={messages.length > 0}
        />

        <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto overscroll-contain px-4 py-5">
          {messages.length === 0 && !pending ? (
            <Welcome copy={copy} suggestions={suggestions} onPick={submit} available={available} />
          ) : (
            <ul className="space-y-5">
              {messages.map((m) => (
                <Message
                  key={m.id}
                  message={m}
                  rating={ratings[m.id]}
                  onRate={(rating) => dispatch(rateMessage({ messageId: m.id, rating }))}
                />
              ))}
              {pending && <Thinking />}
            </ul>
          )}

          {error && (
            <div className="mt-5 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
              <p>{error}</p>
              {errorCode === 'RATE_LIMITED' && (
                <p className="mt-2 text-xs">
                  Or email a founder directly —{' '}
                  <a className="underline" href="mailto:hello@sakhaai.com">
                    hello@sakhaai.com
                  </a>
                  .
                </p>
              )}
              <button
                type="button"
                className="mt-2 text-xs font-medium underline underline-offset-2"
                onClick={() => dispatch(dismissError())}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>

        <Composer
          ref={inputRef}
          value={draft}
          onChange={setDraft}
          onSubmit={() => submit()}
          pending={pending}
          disabled={available === false}
          placeholder={copy.placeholder ?? 'Ask Sakha…'}
          disclaimer={copy.disclaimer}
        />
      </aside>
    </>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function Header({ copy, knowledge, onClose, onNew, hasMessages }) {
  return (
    <header className="flex items-start gap-3 border-b border-line px-4 py-4">
      <SakhaMark />
      <div className="min-w-0 flex-1">
        <p className="font-display text-lg font-semibold leading-tight text-ink">
          {copy.name ?? 'Sakha'}
        </p>
        <p className="text-xs text-subtle">
          {knowledge?.lastUpdatedAt ? (
            <>
              Knowledge updated{' '}
              <time dateTime={knowledge.lastUpdatedAt}>{relativeTime(knowledge.lastUpdatedAt)}</time>
            </>
          ) : (
            <>Sakha means friend</>
          )}
        </p>
      </div>

      {hasMessages && (
        <button
          type="button"
          onClick={onNew}
          className="rounded px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-raised hover:text-ink"
          title="Start a new conversation"
        >
          New
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        className="-mr-1 rounded p-1.5 text-muted transition-colors hover:bg-raised hover:text-ink"
        aria-label="Close Sakha"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      </button>
    </header>
  );
}

function SakhaMark({ className }) {
  return (
    <div
      className={clsx(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ink font-display text-lg font-semibold text-accent',
        className
      )}
      aria-hidden="true"
    >
      S
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function Welcome({ copy, suggestions, onPick, available }) {
  if (available === false) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning/5 p-4 text-sm text-warning">
        <p className="font-semibold">Sakha is not connected yet.</p>
        <p className="mt-1.5 leading-relaxed">
          Add a <code className="font-mono text-xs">GROQ_API_KEY</code> to your <code className="font-mono text-xs">.env</code> and
          restart the API. Everything else on the site works without it.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <p className="text-base leading-relaxed text-muted">
        {copy.greeting ??
          "I'm Sakha. I know this company — the services, the prices, what we will and won't build. Ask me anything, and I'll tell you when I don't know."}
      </p>

      {suggestions.length > 0 && (
        <div className="mt-6">
          <p className="mb-2.5 text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
            Try asking
          </p>
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => onPick(s)}
                  className="w-full rounded-md border border-line bg-paper px-3 py-2.5 text-left text-sm leading-snug text-ink transition-colors hover:border-accent/40 hover:bg-accent-soft"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Messages ──────────────────────────────────────────────────────────────────

function Message({ message, rating, onRate }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <li className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-br-sm bg-ink px-3.5 py-2.5 text-sm leading-relaxed text-paper">
          {message.content}
        </div>
      </li>
    );
  }

  return (
    <li className="animate-fade-up">
      <div className="flex gap-2.5">
        <SakhaMark className="h-7 w-7 rounded text-sm" />
        <div className="min-w-0 flex-1">
          <div className="prose-assistant text-sm leading-relaxed text-ink">
            {renderMarkdown(message.content)}
          </div>

          {message.citations?.length > 0 && <Citations citations={message.citations} />}

          {!message.local && (
            <div className="mt-2 flex items-center gap-1">
              <RateButton active={rating === 'up'} onClick={() => onRate('up')} label="Helpful">
                <path d="M6 9v7H3V9h3zm2 0l3-6a2 2 0 012 2v3h4a1.5 1.5 0 011.47 1.8l-1.1 5.5A1.5 1.5 0 0115.9 17H8V9z" />
              </RateButton>
              <RateButton active={rating === 'down'} onClick={() => onRate('down')} label="Not helpful">
                <path d="M14 11V4h3v7h-3zm-2 0l-3 6a2 2 0 01-2-2v-3H3a1.5 1.5 0 01-1.47-1.8l1.1-5.5A1.5 1.5 0 014.1 3H12v8z" />
              </RateButton>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function RateButton({ active, onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={clsx(
        'rounded p-1 transition-colors',
        active ? 'text-accent' : 'text-subtle hover:bg-raised hover:text-muted'
      )}
    >
      <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

/**
 * Sources. The reason this is worth the screen space: it is the difference
 * between an assistant you have to fact-check and one you can click through.
 */
function Citations({ citations }) {
  return (
    <div className="mt-3 border-t border-line pt-2.5">
      <p className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
        From
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {citations.map((c, i) => {
          const label = c.heading && c.heading !== c.title ? `${c.title} › ${c.heading}` : c.title;
          const inner = (
            <span className="inline-flex max-w-[15rem] items-center gap-1 truncate rounded border border-line bg-paper px-2 py-1 text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent">
              {c.url && (
                <svg width="10" height="10" viewBox="0 0 20 20" fill="none" className="shrink-0" aria-hidden="true">
                  <path d="M8 4H5a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1v-3M12 4h4v4M16 4l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              )}
              <span className="truncate">{label}</span>
            </span>
          );
          return (
            <li key={`${c.url ?? c.title}-${i}`}>
              {c.url?.startsWith('/') ? <Link to={c.url}>{inner}</Link> : c.url ? <a href={c.url} target="_blank" rel="noreferrer noopener">{inner}</a> : inner}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Thinking() {
  return (
    <li className="flex gap-2.5">
      <SakhaMark className="h-7 w-7 rounded text-sm" />
      <div className="flex items-center gap-1 pt-2.5" aria-label="Sakha is thinking">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-subtle"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </div>
    </li>
  );
}

// ── Composer ──────────────────────────────────────────────────────────────────

const Composer = function Composer({ value, onChange, onSubmit, pending, disabled, placeholder, disclaimer }) {
  const ref = useRef(null);

  // Grow with the content up to a ceiling, then scroll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [value]);

  return (
    <div className="border-t border-line bg-surface px-4 py-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="flex items-end gap-2 rounded-lg border border-line bg-paper p-1.5 focus-within:border-accent"
      >
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a newline. Matches every chat surface
            // people already use, so nobody has to learn anything.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={disabled ? 'Sakha is not connected' : placeholder}
          className="scroll-thin max-h-[140px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed text-ink placeholder:text-subtle focus:outline-none disabled:cursor-not-allowed"
          aria-label="Ask Sakha a question"
        />
        <Button
          type="submit"
          variant="accent"
          size="sm"
          className="h-8 w-8 shrink-0 rounded-md p-0"
          disabled={disabled || pending || !value.trim()}
          aria-label="Send"
        >
          {pending ? (
            <Spinner className="h-3.5 w-3.5" />
          ) : (
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M10 16V4M10 4L5 9M10 4l5 5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </Button>
      </form>

      {disclaimer && <p className="mt-2 px-1 text-2xs leading-snug text-subtle">{disclaimer}</p>}
    </div>
  );
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * A deliberately tiny markdown renderer: paragraphs, bullet lists, bold, and
 * inline code. Sakha is instructed to answer in short prose, so pulling in a
 * full markdown library (and a sanitiser to go with it) would be more
 * dependency and more attack surface than the output warrants.
 */
function renderMarkdown(text) {
  const blocks = String(text ?? '').split(/\n{2,}/);

  return blocks.map((block, bi) => {
    const lines = block.split('\n');
    const isList = lines.every((l) => /^\s*[-*•]\s+/.test(l) || l.trim() === '');
    const isNumbered = lines.every((l) => /^\s*\d+[.)]\s+/.test(l) || l.trim() === '');

    if (isList && lines.some((l) => l.trim())) {
      return (
        <ul key={bi} className="my-2 space-y-1 pl-4">
          {lines.filter((l) => l.trim()).map((l, li) => (
            <li key={li} className="list-disc marker:text-subtle">
              {inline(l.replace(/^\s*[-*•]\s+/, ''))}
            </li>
          ))}
        </ul>
      );
    }

    if (isNumbered && lines.some((l) => l.trim())) {
      return (
        <ol key={bi} className="my-2 space-y-1 pl-4">
          {lines.filter((l) => l.trim()).map((l, li) => (
            <li key={li} className="list-decimal marker:text-subtle">
              {inline(l.replace(/^\s*\d+[.)]\s+/, ''))}
            </li>
          ))}
        </ol>
      );
    }

    return (
      <p key={bi} className="mb-2 last:mb-0">
        {inline(block)}
      </p>
    );
  });
}

/** Bold and inline code. Everything else is rendered as literal text. */
function inline(text) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={i} className="rounded bg-raised px-1 py-0.5 font-mono text-xs">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
