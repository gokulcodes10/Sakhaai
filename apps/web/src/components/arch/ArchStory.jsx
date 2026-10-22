import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Button } from '../ui/index.jsx';
import { Emblem } from '../brand/Emblem.jsx';

// Dark-only: the scene's fog and lighting are tuned for #14161A, so this band
// stays dark in both themes. Hues are the brand's light-on-dark variants.
const STEP_HUES = [
  { hex: '#3A5BD9', ink: '#9FB2FF' }, // data
  { hex: '#18937F', ink: '#5CC4AE' }, // models
  { hex: '#E0603C', ink: '#F0845F' }, // keystone
  { hex: '#7A4FD4', ink: '#B7A2F0' }, // production
];
const RAIL_ARCH = { hex: '#F5F4F1', ink: '#F5F4F1' };

const progressOf = (el) => {
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  const range = r.height - window.innerHeight;
  return range > 0 ? Math.min(1, Math.max(0, -r.top / range)) : 0;
};

/**
 * The home page's opening: a sticky three.js keystone arch with five
 * full-height text panels scrolling over it. Scroll progress drives the scene
 * (which member is lit, the keystone lock, the particle flow) and the rail.
 */
export default function ArchStory({ arch, primaryCta, secondaryCta }) {
  const trackRef = useRef(null);
  const stageRef = useRef(null);
  const [step, setStep] = useState(0);
  const [failed, setFailed] = useState(false);

  // Mount the scene. three.js is fetched here, not in the entry bundle.
  useEffect(() => {
    let dispose;
    let cancelled = false;
    import('./archScene.js')
      .then(({ createArchScene }) => {
        if (cancelled || !stageRef.current) return;
        dispose = createArchScene(stageRef.current, { getProgress: () => progressOf(trackRef.current) });
      })
      .catch((err) => {
        console.warn('Arch scene unavailable, showing the static emblem instead.', err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  // The rail only needs the nearest step, so it updates on scroll, not per frame.
  useEffect(() => {
    const onScroll = () => setStep(Math.round(progressOf(trackRef.current) * 4));
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const steps = arch?.steps ?? [];
  const rail = [{ rail: 'Arch' }, ...steps];

  return (
    <section ref={trackRef} className="relative bg-[#14161A] text-[#F5F4F1]" aria-label="How Asphalix agents hold">
      <div className="sticky top-0 h-dvh overflow-hidden">
        <div ref={stageRef} className="absolute inset-0" />
        {failed && <StaticArch />}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[34vh] bg-gradient-to-t from-[#14161A] from-[12%] to-transparent"
        />
        <ol aria-hidden="true" className="absolute right-16 top-1/2 z-[3] hidden -translate-y-1/2 gap-3.5 sm:grid">
          {rail.map((r, i) => {
            const hue = i === 0 ? RAIL_ARCH : STEP_HUES[i - 1];
            const active = i === step;
            return (
              <li key={r.rail} className="flex items-center justify-end gap-2.5">
                <span
                  className="font-mono text-[10.5px] uppercase tracking-[0.14em] transition-colors"
                  style={{ color: active ? hue.ink : '#6A6F76' }}
                >
                  {r.rail}
                </span>
                <span
                  className="h-[3px] rounded-sm transition-all duration-300"
                  style={{ width: active ? 28 : 12, background: active ? hue.hex : '#3A3E45' }}
                />
              </li>
            );
          })}
        </ol>
      </div>

      <div className="relative z-[2] -mt-[100dvh]">
        <Panel>
          <div className="max-w-[600px]">
            <p className="eyebrow mb-6 text-[#B4B8BD] before:!bg-[#E0603C]">{arch?.hero?.eyebrow}</p>
            <h1 className="text-[clamp(2.625rem,6vw,5rem)] leading-[0.98] tracking-[-0.04em] text-[#F5F4F1]">
              {arch?.hero?.headline}
            </h1>
            <p className="mt-6 max-w-[520px] text-[clamp(1.0625rem,1.6vw,1.25rem)] leading-[1.55] text-[#C9CCD0]">
              {arch?.hero?.subhead}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {primaryCta && (
                <Button variant="bare" to={primaryCta.href} size="lg" className="bg-[#3A5BD9] text-white hover:bg-[#4A6BE9]">
                  {primaryCta.label}
                </Button>
              )}
              {secondaryCta && (
                <Button
                  variant="bare"
                  to={secondaryCta.href}
                  size="lg"
                  className="border border-[#F5F4F1]/25 text-[#F5F4F1] hover:border-[#F5F4F1]"
                >
                  {secondaryCta.label}
                </Button>
              )}
            </div>
            {arch?.hero?.scrollHint && (
              <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8F94]">
                {arch.hero.scrollHint}
              </p>
            )}
          </div>
        </Panel>

        {steps.map((s, i) => {
          const hue = STEP_HUES[i] ?? STEP_HUES[0];
          const last = i === steps.length - 1;
          return (
            <Panel key={s.label}>
              <div className="max-w-[540px]">
                <p
                  className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.16em]"
                  style={{ color: hue.ink }}
                >
                  <span className="h-3 w-3 rounded-[3px]" style={{ background: hue.hex }} />
                  {s.label}
                </p>
                <h2 className="mt-5 text-[clamp(2rem,4vw,3.25rem)] leading-[1.05] text-[#F5F4F1]">{s.headline}</h2>
                <p className="mt-5 text-lg leading-[1.6] text-[#C9CCD0]">{s.body}</p>
                {s.chips?.length > 0 && (
                  <ul className="mt-5 flex flex-wrap gap-2">
                    {s.chips.map((c) => (
                      <li
                        key={c}
                        className="rounded-sm border border-[#F5F4F1]/15 bg-[#14161A]/60 px-2.5 py-1.5 font-mono text-xs text-[#DADDE0]"
                      >
                        {c}
                      </li>
                    ))}
                  </ul>
                )}
                {last && primaryCta && (
                  <Button variant="bare" to={primaryCta.href} size="lg" className="mt-8 bg-[#F5F4F1] text-[#14161A] hover:bg-white">
                    {primaryCta.label}
                  </Button>
                )}
              </div>
            </Panel>
          );
        })}
      </div>
    </section>
  );
}

function Panel({ children, className }) {
  return (
    <div className={clsx('shell flex min-h-dvh flex-col justify-end pb-[13vh]', className)}>{children}</div>
  );
}

/** Shown when WebGL is unavailable: the emblem on the grid-paper ink panel. */
function StaticArch() {
  return (
    <div className="absolute inset-0 flex items-center justify-center sm:justify-end sm:pr-[12%]">
      <div className="grid-paper relative aspect-square w-[min(70vw,440px)] rounded-xl border border-[#F5F4F1]/10">
        <div className="absolute inset-[16%]">
          <Emblem size="100%" />
        </div>
      </div>
    </div>
  );
}
