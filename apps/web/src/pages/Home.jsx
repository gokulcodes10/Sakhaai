import { Link } from 'react-router';
import { useDispatch, useSelector } from 'react-redux';
import clsx from 'clsx';
import { selectContent } from '../features/content/contentSlice.js';
import { askSakha, openPanel } from '../features/sakha/sakhaSlice.js';
import { Button, Card, Eyebrow, HUES, Section, SectionHeading, Stat } from '../components/ui/index.jsx';
import { Emblem } from '../components/brand/Emblem.jsx';
import ArchStory from '../components/arch/ArchStory.jsx';
import Seo from '../components/layout/Seo.jsx';

// The trust strip's four items take the four hues in brand order.
const STRIP_HUES = ['accent', 'trust', 'keystone', 'iris'];

export default function Home() {
  const content = useSelector(selectContent);
  const dispatch = useDispatch();

  if (!content) return null;
  const { home, services, work } = content;
  const cases = (work?.caseStudies ?? []).filter((c) => c.published).slice(0, 2);

  return (
    <>
      <Seo title={null} description={content.seo?.defaultDescription} />

      {/* ── Keystone arch scroll story (three.js) ───────────────────────────── */}
      {home.arch ? (
        <ArchStory arch={home.arch} primaryCta={home.hero.primaryCta} secondaryCta={home.hero.secondaryCta} />
      ) : (
        <StaticHero hero={home.hero} />
      )}

      {/* ── Trust strip ─────────────────────────────────────────────────────── */}
      {home.trustStrip?.enabled && (
        <div className="border-b border-line bg-surface">
          <div className="shell py-8">
            <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              {home.trustStrip.items.map((item, i) => (
                <li key={item.text} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-[2px]', HUES[STRIP_HUES[i % 4]].bg)}
                  />
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
          <ol className="lg:pt-10">
            {home.problem.points.map((p, i) => (
              <li key={p.title} className="grid grid-cols-[3rem_1fr] border-t border-line py-7 last:border-b">
                <span className="pt-1 font-mono text-sm text-subtle">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <h3 className="text-xl tracking-[-0.015em]">{p.title}</h3>
                  <p className="mt-2 leading-relaxed text-muted">{p.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {/* ── What we build ───────────────────────────────────────────────────── */}
      <Section tone="surface">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading
            hue="accent"
            eyebrow={home.servicesIntro.eyebrow}
            title={home.servicesIntro.headline}
            body={home.servicesIntro.body}
          />
          {home.servicesIntro.cta && (
            <Link to={home.servicesIntro.cta.href} className="font-medium text-accent hover:underline">
              {home.servicesIntro.cta.label} →
            </Link>
          )}
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {services.items.map((s, i) => {
            const hue = HUES[s.hue] ? s.hue : STRIP_HUES[i % 4];
            return (
              <Card
                key={s.slug}
                as={Link}
                to={`/services/${s.slug}`}
                hue={hue}
                className="flex flex-col bg-paper transition-colors hover:border-ink"
              >
                <span className="flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.14em]">
                  <span className="text-subtle">{String(i + 1).padStart(2, '0')}</span>
                  {s.tag && <span className={HUES[hue].text}>{s.tag}</span>}
                </span>
                <h3 className="mt-3.5 text-xl leading-tight tracking-[-0.015em]">{s.name}</h3>
                <p className="mt-2.5 flex-1 text-[0.9375rem] leading-relaxed text-muted">{s.oneLiner}</p>
                <span className={clsx('mt-5 text-sm font-medium', HUES[hue].text)}>How it works →</span>
              </Card>
            );
          })}
        </div>
      </Section>

      {/* ── How an engagement runs ──────────────────────────────────────────── */}
      <Section>
        <SectionHeading
          hue="trust"
          eyebrow={home.howItWorks.eyebrow}
          title={home.howItWorks.headline}
          body={home.howItWorks.body}
        />

        <ol className="mt-14 grid gap-x-8 gap-y-10 border-t-2 border-ink pt-8 sm:grid-cols-2 lg:grid-cols-5">
          {home.howItWorks.steps.map((step, i) => (
            <li key={step.title}>
              <span className="font-mono text-xs text-subtle">{String(i + 1).padStart(2, '0')}</span>
              <p className="mt-2 font-mono text-xs uppercase tracking-[0.12em] text-trust">{step.day}</p>
              <h3 className="mt-3 text-lg leading-snug tracking-[-0.01em]">{step.title}</h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* ── Proof ───────────────────────────────────────────────────────────── */}
      {cases.length > 0 && (
        <Section tone="surface">
          <SectionHeading eyebrow={home.proof.eyebrow} title={home.proof.headline} body={home.proof.body} />

          <div className="mt-12 space-y-8">
            {cases.map((cs) => (
              <article
                key={cs.slug}
                className="grid overflow-hidden rounded-lg border border-line bg-surface lg:grid-cols-[1.5fr_1fr]"
              >
                <div className="p-8">
                  {cs.isDogfood && (
                    <span className="mb-4 inline-block rounded-sm bg-trust-soft px-2 py-1 font-mono text-2xs uppercase tracking-[0.12em] text-trust">
                      Our own operations
                    </span>
                  )}
                  <h3 className="text-2xl tracking-[-0.015em]">{cs.headline}</h3>
                  <p className="mt-2 font-mono text-xs text-subtle">
                    {cs.client}
                    {cs.clientNote && <> · {cs.clientNote}</>}
                  </p>
                  <p className="mt-4 max-w-prose leading-relaxed text-muted">{cs.challenge}</p>
                  <Link to="/work" className="mt-5 inline-block text-sm font-medium text-accent hover:underline">
                    Read the whole thing →
                  </Link>
                </div>

                <div className="space-y-7 border-t border-line bg-paper p-8 lg:border-l lg:border-t-0">
                  {(cs.metrics ?? []).map((m, i) => (
                    <Stat
                      key={m.label}
                      value={m.value}
                      label={m.label}
                      note={m.note}
                      tone={i % 2 ? 'accent' : 'trust'}
                    />
                  ))}
                </div>
              </article>
            ))}
          </div>
        </Section>
      )}

      {/* ── Meet Sakha ──────────────────────────────────────────────────────── */}
      <section className="bg-[#14161A] py-18 text-[#F5F4F1] sm:py-26">
        <div className="shell grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <p className="eyebrow text-[#F0845F]">{home.assistantPitch.eyebrow}</p>
            <h2 className="mt-4 text-3xl leading-[1.08] text-[#F5F4F1] sm:text-[2.875rem]">
              {home.assistantPitch.headline}
            </h2>
            <p className="mt-5 max-w-prose text-lg leading-relaxed text-[#B4B8BD]">{home.assistantPitch.body}</p>
            <Button variant="bare"
              size="lg"
              className="mt-8 bg-[#F5F4F1] text-[#14161A] hover:bg-white"
              onClick={() => dispatch(openPanel())}
            >
              <Emblem size={20} />
              {home.assistantPitch.cta.label}
            </Button>
          </div>

          <div className="rounded-lg border border-[#2E3137] bg-[#1B1D21] p-6">
            <p className="flex items-center justify-between font-mono text-2xs uppercase tracking-[0.14em] text-[#8A8F94]">
              Things people actually ask
              <span className="flex items-center gap-1.5 text-[#5CC4AE]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#5CC4AE]" aria-hidden="true" />
                Live
              </span>
            </p>
            <ul className="mt-4 space-y-2.5">
              {(home.assistantPitch.suggestions ?? []).map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => dispatch(askSakha(q))}
                    className="w-full rounded-md border border-[#2E3137] px-3.5 py-2.5 text-left text-sm leading-snug text-[#DADDE0] transition-colors hover:border-[#6E8AF0] hover:bg-[#20232A]"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────────── */}
      <section className="py-18 sm:py-28">
        <div className="shell">
          <div className="mx-auto max-w-[760px] text-center">
            <h2 className="text-3xl leading-[1.08] sm:text-[2.875rem]">{home.finalCta.headline}</h2>
            <p className="mx-auto mt-5 max-w-prose text-lg leading-relaxed text-muted">{home.finalCta.body}</p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Button to={home.finalCta.primaryCta.href} variant="accent" size="lg">
                {home.finalCta.primaryCta.label}
              </Button>
              <CtaButton cta={home.finalCta.secondaryCta} onAssistant={() => dispatch(openPanel())} />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/** A CMS call to action that either links somewhere or opens Sakha. */
function CtaButton({ cta, onAssistant }) {
  if (!cta) return null;
  if (cta.action === 'open-assistant') {
    return (
      <Button variant="outline" size="lg" onClick={onAssistant}>
        {cta.label}
      </Button>
    );
  }
  return (
    <Button to={cta.href} variant="outline" size="lg">
      {cta.label}
    </Button>
  );
}

/** Used only if the CMS has no `home.arch` block: the Home mockup's light hero. */
function StaticHero({ hero }) {
  return (
    <section className="border-b border-line">
      <div className="shell grid items-center gap-12 pb-24 pt-20 lg:grid-cols-2">
        <div>
          {hero.eyebrow && <Eyebrow className="mb-6">{hero.eyebrow}</Eyebrow>}
          <h1 className="text-[clamp(2.5rem,5.6vw,4.5rem)] leading-none tracking-[-0.035em]">{hero.headline}</h1>
          <p className="mt-6 max-w-xl text-xl leading-[1.55] text-muted">{hero.subhead}</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button to={hero.primaryCta.href} variant="accent" size="lg">
              {hero.primaryCta.label}
            </Button>
            <Button to={hero.secondaryCta.href} variant="outline" size="lg">
              {hero.secondaryCta.label}
            </Button>
          </div>
          {hero.assurance && <p className="meta mt-7">{hero.assurance}</p>}
        </div>
        <div className="grid-paper relative aspect-square rounded-xl bg-[#14161A]">
          <div className="absolute inset-[16%]">
            <Emblem size="100%" />
          </div>
          <p className="absolute inset-x-0 bottom-6 text-center font-mono text-2xs uppercase tracking-[0.14em] text-[#8A8F94]">
            Your data · Your models · Your perimeter
          </p>
        </div>
      </div>
    </section>
  );
}
