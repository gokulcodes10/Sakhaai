/**
 * The affordance that opens Sakha.
 *
 * It is a labelled rail tab, not a circular chat bubble — a bubble reads as
 * "support widget, probably a bot, probably useless", which is precisely the
 * expectation this product needs to defeat.
 */

import { useDispatch, useSelector } from 'react-redux';
import clsx from 'clsx';
import { togglePanel } from '../../features/sakha/sakhaSlice.js';
import { selectContent } from '../../features/content/contentSlice.js';

export default function SakhaLauncher() {
  const dispatch = useDispatch();
  const { open, unreadReply, available } = useSelector((s) => s.sakha);
  const content = useSelector(selectContent);
  const label = content?.assistant?.openLabel ?? 'Ask Sakha';

  return (
    <button
      type="button"
      onClick={() => dispatch(togglePanel())}
      aria-expanded={open}
      className={clsx(
        'group fixed right-0 top-1/2 z-30 -translate-y-1/2 rounded-l-lg border border-r-0 border-line',
        'bg-ink py-4 pl-3 pr-2.5 text-paper shadow-lift transition-all duration-300 ease-out',
        'hover:pl-4 hover:bg-ink/95',
        open && 'pointer-events-none translate-x-full opacity-0'
      )}
    >
      <span className="flex flex-col items-center gap-2.5">
        <span className="relative flex h-6 w-6 items-center justify-center rounded font-display text-base font-semibold text-accent">
          S
          {available && (
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
          )}
          {unreadReply && (
            <span className="absolute -right-1 -top-1 h-2 w-2 animate-pulse-dot rounded-full bg-accent" aria-hidden="true" />
          )}
        </span>
        <span
          className="text-2xs font-semibold uppercase tracking-[0.16em] text-paper/80 group-hover:text-paper"
          style={{ writingMode: 'vertical-rl' }}
        >
          {label}
        </span>
      </span>
    </button>
  );
}
