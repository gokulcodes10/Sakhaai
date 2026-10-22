import clsx from 'clsx';

/**
 * The Asphalix mark: two leaning piers and a keystone. Geometry is verbatim
 * from re-branding/UI mockups project/Emblem.dc.html (64-unit grid).
 *
 * Identity Kit rules: never stretch it or swap in other hues; below 20px use
 * the two-colour build (right pier takes the left pier's colour).
 */
export const BRAND_HUES = { c1: '#3A5BD9', c2: '#18937F', c3: '#E0603C' };

export function Emblem({ size = 32, mono, c1 = BRAND_HUES.c1, c2 = BRAND_HUES.c2, c3 = BRAND_HUES.c3, className, title }) {
  const px = typeof size === 'number' ? size : null;
  if (mono) c1 = c2 = c3 = mono;
  else if (px !== null && px < 20) c2 = c1;

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      className={clsx('block shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
    >
      <rect x="12" y="24" width="13" height="32" rx="5.5" fill={c1} transform="rotate(10 18.5 40)" />
      <rect x="39" y="24" width="13" height="32" rx="5.5" fill={c2} transform="rotate(-10 45.5 40)" />
      <rect x="23" y="8" width="18" height="13" rx="5" fill={c3} />
    </svg>
  );
}

/** ASPHALIX, tracked out. The negative right margin cancels the trailing track. */
export function Wordmark({ className }) {
  return (
    <span className={clsx('font-semibold uppercase tracking-[0.24em] mr-[-0.24em] leading-none', className)}>
      Asphalix
    </span>
  );
}

/** Horizontal lockup: emblem, then the wordmark at a 0.8× emblem gap. */
export function Lockup({ size = 32, className, wordmarkClassName }) {
  return (
    <span className={clsx('inline-flex items-center', className)} style={{ gap: size * 0.4 }}>
      <Emblem size={size} />
      <Wordmark className={clsx('text-base text-ink', wordmarkClassName)} />
    </span>
  );
}
