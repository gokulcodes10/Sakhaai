import { Link } from 'react-router';
import { useDispatch, useSelector } from 'react-redux';
import { selectContent } from '../features/content/contentSlice.js';
import { openPanel } from '../features/sakha/sakhaSlice.js';
import { Button, Section, SectionHeading, Stat } from '../components/ui/index.jsx';
import Seo from '../components/layout/Seo.jsx';

export default function Home() {
  const content = useSelector(selectContent);
  const dispatch = useDispatch();

  if (!content) return null;
  const { home, services, pricing, work } = content;

  return (
    <>
      <Seo title={null} description={content.seo?.defaultDescription} />

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="shell pb-20 pt-16 sm:pb-30 sm:pt-24">
          <div className="max-w-3xl">
            {home.hero.eyebrow && (
              <p className="eyebrow mb-5 animate-fade-up">{home.hero.eyebrow}</p>
            )}

            <h1 className="animate-fade-up text-4xl sm:text-5xl lg:text-6xl" style={{ animationDelay: '40ms' }}>
              {home.hero.headline}
            </h1>

            <p
              className="mt-7 max-w-2xl animate-fade-up text-lg leading-relaxed text-muted sm:text-xl"
              style={{ animationDelay: '90ms' }}
            >
              {home.hero.subhead}
            </p>

            <div className="mt-9 flex animate-fade-up flex-wrap gap-3" style={{ animationDelay: '140ms' }}>
              <Button to={home.hero.primaryCta.href} variant="accent" size="lg">
                {home.hero.primaryCta.label}
              </Button>
              <Button to={home.hero.secondaryCta.href} variant="outline" size="lg">
                {home.hero.secondaryCta.label}
              </Button>
            </div>

            {home.hero.assurance && (
              <p
                className="mt-7 animate-fade-up font-mono text-xs text-subtle sm:text-sm"
                style={{ animationDelay: '190ms' }}
              >
                {home.hero.assurance}
              </p>
            )}
          </div>
        </div>

        {/* A quiet typographic watermark rather than an illustration — the whole
            visual argument is "we are not the gradient-and-glow kind of AI firm". */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-8 -top-10 select-none font-display text-[22rem] font-semibold leading-none text-ink/[0.025] sm:text-[30rem]"
        >
          S
        </div>
      </section>

      {/* ── Trust strip ─────────────────────────────────────────────────────── */}
      {home.trustStrip?.enabled && (
        <div className="border-b border-line bg-surface">
          <div className="shell py-8">
            <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              {home.trustStrip.items.map((item) => (
                <li key={item.text} className="flex items-start gap-2.5">
                  <CheckMark />
                  <span className="text-sm leading-snug text-muted">{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── The problem ─────────────────────────────────────────────────────── */}
      <Section>
        <div className="grid gap-14 lg:grid-cols-[1fr_1.15fr]">
          <SectionHeading eyebrow={home.problem.eyebrow} title={home.problem.headline} body={home.problem.body} />
          <ul className="space-y-8 lg:pt-14">
            {home.problem.points.map((p) => (
              <li key={p.title} className="border-l-2 border-line pl-5">
                <h3 className="text-xl">{p.title}</h3>
                <p className="mt-2 leading-relaxed text-muted">{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* ── Services ────────────────────────────────────────────────────────── */}
      <Section tone="surface">
        <SectionHeading
          eyebrow={home.servicesIntro.eyebrow}
          title={home.servicesIntro.headline}
          body={home.servicesIntro.body}
        />

        <div className="mt-14 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
          {services.items.map((s, i) => (
            <Link
              key={s.slug}
              to={`/services/${s.slug}`}
              className="group flex flex-col bg-surface p-7 transition-colors hover:bg-accent-soft"
            >
              <span className="font-mono text-2xs text-subtle">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="mt-3 text-xl transition-colors group-hover:text-accent">{s.name}</h3>
              <p className="mt-2.5 flex-1 leading-relaxed text-muted">{s.oneLiner}</p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-accent">
                How it works
                <Arrow />
              </span>
            </Link>
          ))}
        </div>
      </Section>

      {/* ── How it works ────────────────────────────────────────────────────── */}
      <Section>
        <SectionHeading
          eyebrow={home.howItWorks.eyebrow}
          title={home.howItWorks.headline}
          body={home.howItWorks.body}
        />

        <ol className="mt-16 space-y-0">
          {home.howItWorks.steps.map((step, i) => (
            <li
              key={step.title}
              className="grid gap-4 border-t border-line py-8 sm:grid-cols-[9rem_1fr] sm:gap-10 last:border-b"
            >
              <div className="flex items-baseline gap-3 sm:flex-col sm:gap-1">
                <span className="font-mono text-2xs text-subtle">{String(i + 1).padStart(2, '0')}</span>
                <span className="font-display text-lg font-semibold text-accent">{step.day}</span>
              </div>
              <div>
                <h3 className="text-xl">{step.title}</h3>
                <p className="mt-2.5 max-w-prose leading-relaxed text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {/* ── Pricing preview ─────────────────────────────────────────────────── */}
      <Section tone="surface">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading
            eyebrow="Pricing"
            title="We publish our prices."
            body="Almost nobody in this industry does. We think that is a tell."
          />
          <Button to="/pricing" variant="outline">
            See the full breakdown
          </Button>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {pricing.tiers.map((tier) => (
            <Link
              key={tier.slug}
              to="/pricing"
              className={`group rounded-lg border p-6 transition-all hover:shadow-card ${
                tier.featured ? 'border-accent bg-accent-soft/40' : 'border-line bg-paper'
              }`}
            >
              {tier.badge && (
                <span className="mb-3 inline-block rounded-full bg-accent px-2.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-accent-ink">
                  {tier.badge}
                </span>
              )}
              <h3 className="text-lg">{tier.name}</h3>
              <p className="mt-3 font-display text-3xl font-semibold text-ink">{tier.priceDisplay}</p>
              <p className="mt-1.5 text-sm text-subtle">{tier.duration}</p>
              <p className="mt-4 text-sm leading-relaxed text-muted">{tier.tagline}</p>
            </Link>
          ))}
        </div>
      </Section>

      {/* ── Proof ───────────────────────────────────────────────────────────── */}
      {work?.caseStudies?.filter((c) => c.published).length > 0 && (
        <Section>
          <SectionHeading eyebrow={home.proof.eyebrow} title={home.proof.headline} body={home.proof.body} />

          <div className="mt-14 space-y-10">
            {work.caseStudies
              .filter((c) => c.published)
              .slice(0, 2)
              .map((cs) => (
                <article key={cs.slug} className="grid gap-8 rounded-lg border border-line bg-surface p-8 lg:grid-cols-[1.5fr_1fr]">
                  <div>
                    {cs.isDogfood && (
                      <span className="mb-3 inline-block rounded-full border border-trust/30 bg-trust-soft px-2.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-trust">
                        Our own operations
                      </span>
                    )}
                    <h3 className="text-2xl">{cs.headline}</h3>
                    <p className="mt-2 text-sm text-subtle">
                      {cs.client}
                      {cs.clientNote && <> · {cs.clientNote}</>}
                    </p>
                    <p className="mt-4 max-w-prose leading-relaxed text-muted">{cs.challenge}</p>
                    <Link
                      to="/work"
                      className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-accent"
                    >
                      Read the whole thing
                      <Arrow />
                    </Link>
                  </div>

                  <div className="space-y-6 lg:border-l lg:border-line lg:pl-8">
                    {(cs.metrics ?? []).map((m) => (
                      <Stat key={m.label} value={m.value} label={m.label} note={m.note} />
                    ))}
                  </div>
                </article>
              ))}
          </div>
        </Section>
      )}

      {/* ── Sakha ───────────────────────────────────────────────────────────── */}
      <Section tone="ink">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-accent">
              {home.assistantPitch.eyebrow}
            </p>
            <h2 className="mt-4 text-3xl text-paper sm:text-4xl">{home.assistantPitch.headline}</h2>
            <p className="mt-5 max-w-prose text-lg leading-relaxed text-paper/70">
              {home.assistantPitch.body}
            </p>
            <Button
              variant="accent"
              size="lg"
              className="mt-8"
              onClick={() => dispatch(openPanel())}
            >
              {home.assistantPitch.cta.label}
            </Button>
          </div>

          <div className="rounded-lg border border-paper/15 bg-paper/[0.04] p-6">
            <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-paper/40">
              Things people actually ask her
            </p>
            <ul className="mt-4 space-y-2.5">
              {(home.assistantPitch.suggestions ?? []).map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => dispatch(openPanel())}
                    className="w-full rounded-md border border-paper/15 px-3.5 py-2.5 text-left text-sm leading-snug text-paper/85 transition-colors hover:border-accent/50 hover:bg-paper/[0.06]"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* ── Final CTA ───────────────────────────────────────────────────────── */}
      <Section>
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl sm:text-4xl">{home.finalCta.headline}</h2>
          <p className="mx-auto mt-5 max-w-prose text-lg leading-relaxed text-muted">
            {home.finalCta.body}
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Button to={home.finalCta.primaryCta.href} variant="accent" size="lg">
              {home.finalCta.primaryCta.label}
            </Button>
            <Button to={home.finalCta.secondaryCta.href} variant="outline" size="lg">
              {home.finalCta.secondaryCta.label}
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}

const CheckMark = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" className="mt-0.5 shrink-0 text-accent" aria-hidden="true">
    <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Arrow = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M4 10h12M11 5l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
