import { Link, Navigate, useParams } from 'react-router';
import { useSelector } from 'react-redux';
import { selectContent } from '../features/content/contentSlice.js';
import { Button, EmptyState, Section } from '../components/ui/index.jsx';
import Seo from '../components/layout/Seo.jsx';
import PageHero from '../components/layout/PageHero.jsx';
import { CtaBand } from './Services.jsx';

export function Industries() {
  const content = useSelector(selectContent);
  if (!content) return null;

  const { industries } = content;
  const items = (industries.items ?? []).filter((i) => i.published !== false);

  return (
    <>
      <Seo title={industries.meta?.title} description={industries.meta?.description} />
      <PageHero eyebrow={industries.hero.eyebrow} title={industries.hero.headline} subhead={industries.hero.subhead} />

      <Section>
        {items.length === 0 ? (
          <EmptyState title="No industry pages yet." body="Add one from the CMS — it appears here and in the navigation automatically." />
        ) : (
          <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2 lg:grid-cols-3">
            {items.map((ind) => (
              <Link
                key={ind.slug}
                to={`/industries/${ind.slug}`}
                className="group flex flex-col bg-surface p-7 transition-colors hover:bg-accent-soft"
              >
                <h2 className="text-xl transition-colors group-hover:text-accent">{ind.name}</h2>
                <p className="mt-3 flex-1 leading-relaxed text-muted">{ind.headline}</p>
                {ind.metric && (
                  <p className="mt-5 font-mono text-2xs uppercase tracking-wide text-subtle">
                    Metric: {ind.metric}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </Section>

      <CtaBand />
    </>
  );
}

export function IndustryDetail() {
  const { slug } = useParams();
  const content = useSelector(selectContent);
  if (!content) return null;

  const ind = (content.industries.items ?? []).find((i) => i.slug === slug && i.published !== false);
  if (!ind) return <Navigate to="/industries" replace />;

  return (
    <>
      <Seo title={ind.name} description={ind.headline} />
      <PageHero
        eyebrow="Industries"
        title={ind.name}
        subhead={ind.headline}
        back={{ href: '/industries', label: 'All industries' }}
      />

      <Section>
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-10">
            {ind.workflow && (
              <div>
                <p className="eyebrow mb-3">The workflow</p>
                <p className="prose-sakha">{ind.workflow}</p>
              </div>
            )}

            {ind.objection && (
              <div className="rounded-lg border border-line bg-surface p-7">
                <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
                  What people say first
                </p>
                <p className="mt-3 font-display text-xl italic text-ink">“{ind.objection}”</p>
                {ind.objectionAnswer && (
                  <p className="mt-4 leading-relaxed text-muted">{ind.objectionAnswer}</p>
                )}
              </div>
            )}
          </div>

          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            {ind.metric && (
              <div className="rounded-lg border-l-2 border-accent bg-surface p-6">
                <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
                  What we measure
                </p>
                <p className="mt-2 font-display text-xl font-semibold text-ink">{ind.metric}</p>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  Agreed and instrumented before we write any code.
                </p>
              </div>
            )}

            <div className="rounded-lg bg-ink p-6 text-paper">
              <p className="font-display text-lg font-semibold">Work in this sector?</p>
              <p className="mt-2 text-sm leading-relaxed text-paper/70">
                Tell us what breaks most often. You will get a written memo either way.
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
