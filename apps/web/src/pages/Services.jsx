import { Link, useParams, Navigate } from 'react-router';
import { useSelector } from 'react-redux';
import { selectContent } from '../features/content/contentSlice.js';
import { Button, Section, SectionHeading } from '../components/ui/index.jsx';
import Seo from '../components/layout/Seo.jsx';
import PageHero from '../components/layout/PageHero.jsx';

export function Services() {
  const content = useSelector(selectContent);
  if (!content) return null;
  const { services } = content;

  return (
    <>
      <Seo title={services.meta?.title} description={services.meta?.description} />
      <PageHero eyebrow={services.hero.eyebrow} title={services.hero.headline} subhead={services.hero.subhead} />

      <Section>
        <div className="space-y-px overflow-hidden rounded-lg border border-line bg-line">
          {services.items.map((s, i) => (
            <article key={s.slug} className="bg-surface p-8 sm:p-10">
              <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
                <div>
                  <span className="font-mono text-2xs text-subtle">{String(i + 1).padStart(2, '0')}</span>
                  <h2 className="mt-3 text-2xl sm:text-3xl">
                    <Link to={`/services/${s.slug}`} className="transition-colors hover:text-accent">
                      {s.name}
                    </Link>
                  </h2>
                  <p className="mt-3 text-lg text-accent">{s.oneLiner}</p>
                  <p className="mt-5 max-w-prose leading-relaxed text-muted">{s.body}</p>

                  <div className="mt-7 grid gap-5 sm:grid-cols-2">
                    <FitNote tone="success" label="Good fit when" body={s.goodFitWhen} />
                    <FitNote tone="warning" label="Not a fit when" body={s.notAFitWhen} />
                  </div>
                </div>

                <div className="lg:border-l lg:border-line lg:pl-8">
                  {s.outcomes?.length > 0 && (
                    <>
                      <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
                        What changes
                      </p>
                      <ul className="mt-3 space-y-2">
                        {s.outcomes.map((o) => (
                          <li key={o} className="flex gap-2 text-sm leading-snug text-muted">
                            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                            {o}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {s.includes?.length > 0 && (
                    <>
                      <p className="mt-6 text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
                        Included
                      </p>
                      <ul className="mt-3 space-y-2">
                        {s.includes.map((o) => (
                          <li key={o} className="flex gap-2 text-sm leading-snug text-muted">
                            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-line" />
                            {o}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </Section>

      {services.reusableModules && (
        <Section tone="surface">
          <div className="grid gap-12 lg:grid-cols-[1fr_1fr]">
            <SectionHeading
              eyebrow={services.reusableModules.eyebrow}
              title={services.reusableModules.headline}
              body={services.reusableModules.body}
            />
            <ul className="grid grid-cols-2 gap-px self-start overflow-hidden rounded-lg border border-line bg-line">
              {services.reusableModules.modules.map((m) => (
                <li key={m} className="bg-paper px-4 py-3.5 text-sm text-muted">
                  {m}
                </li>
              ))}
            </ul>
          </div>
        </Section>
      )}

      <CtaBand />
    </>
  );
}

export function ServiceDetail() {
  const { slug } = useParams();
  const content = useSelector(selectContent);
  if (!content) return null;

  const service = content.services.items.find((s) => s.slug === slug);
  if (!service) return <Navigate to="/services" replace />;

  return (
    <>
      <Seo title={service.name} description={service.oneLiner} />
      <PageHero eyebrow="What we build" title={service.name} subhead={service.oneLiner} back={{ href: '/services', label: 'All services' }} />

      <Section>
        <div className="grid gap-12 lg:grid-cols-[1.5fr_1fr]">
          <div>
            <p className="prose-sakha">{service.body}</p>

            <div className="mt-10 grid gap-5 sm:grid-cols-2">
              <FitNote tone="success" label="Good fit when" body={service.goodFitWhen} />
              <FitNote tone="warning" label="Not a fit when" body={service.notAFitWhen} />
            </div>

            <div className="mt-10 rounded-lg border border-line bg-surface p-6">
              <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">Included</p>
              <ul className="mt-4 space-y-2.5">
                {(service.includes ?? []).map((o) => (
                  <li key={o} className="flex gap-2.5 leading-snug text-muted">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
                    {o}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-lg border border-line bg-surface p-6">
              <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">What changes</p>
              <ul className="mt-4 space-y-3">
                {(service.outcomes ?? []).map((o) => (
                  <li key={o} className="border-l-2 border-accent pl-3.5 text-sm leading-snug text-ink">
                    {o}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg bg-ink p-6 text-paper">
              <p className="font-display text-lg font-semibold">Want to know if this fits?</p>
              <p className="mt-2 text-sm leading-relaxed text-paper/70">
                Thirty minutes with a founder, and a written memo afterwards — including what we would not build.
              </p>
              <Button to="/contact" variant="accent" className="mt-5 w-full">
                Get a build memo
              </Button>
            </div>
          </aside>
        </div>
      </Section>
    </>
  );
}

function FitNote({ tone, label, body }) {
  if (!body) return null;
  const tones = {
    success: 'border-success/25 bg-success/5',
    warning: 'border-warning/25 bg-warning/5',
  };
  const labelTone = { success: 'text-success', warning: 'text-warning' };
  return (
    <div className={`rounded-md border p-4 ${tones[tone]}`}>
      <p className={`text-2xs font-semibold uppercase tracking-[0.12em] ${labelTone[tone]}`}>{label}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}

export function CtaBand() {
  const content = useSelector(selectContent);
  return (
    <Section tone="surface">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl">Tell us the workflow that keeps breaking.</h2>
        <p className="mt-4 leading-relaxed text-muted">
          {content?.company?.responsePromise ??
            'A founder replies to every enquiry within 24 hours.'}
        </p>
        <Button to="/contact" variant="accent" size="lg" className="mt-7">
          Get a build memo
        </Button>
      </div>
    </Section>
  );
}
