import { useState } from 'react';

const KEY = 'asphalix-rebrand-notice-dismissed';

const readDismissed = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

/** One-line "Sakha AI is now Asphalix" bar above the header, dismissible once. */
export default function RebrandNotice() {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* private browsing */
    }
  };

  return (
    <div className="bg-[#14161A] text-[#F5F4F1]">
      <div className="shell flex min-h-10 items-center gap-3 py-2 text-sm">
        <span className="shrink-0 rounded-sm border border-[#F5F4F1]/25 px-1.5 py-0.5 font-mono text-2xs uppercase tracking-[0.14em] text-[#F0845F]">
          New name
        </span>
        <p className="min-w-0 flex-1 text-[#C9CCD0]">
          Sakha AI is now <strong className="font-semibold text-[#F5F4F1]">Asphalix</strong>. Same founders, same
          team, same code you own.
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-sm p-1 text-[#8A8F94] transition-colors hover:text-[#F5F4F1]"
          aria-label="Dismiss notice"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
