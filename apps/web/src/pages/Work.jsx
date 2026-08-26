import { useSelector } from 'react-redux';
import { selectContent } from '../features/content/contentSlice.js';
import { EmptyState, Section, Stat } from '../components/ui/index.jsx';
import Seo from '../components/layout/Seo.jsx';
import PageHero from '../components/layout/PageHero.jsx';
import { CtaBand } from './Services.jsx';

export default function Work() {
  const content = useSelector(selectContent);
  if (!content) return null;

  const { work } = content;
  const published = (work.caseStudies ?? []).filter((c) => c.published);

  return (
    <>
      <Seo title={work.meta?.title} description={work.meta?.description} />
      <PageHero eyebrow={work.hero.eyebrow} title={work.hero.headline} subhead={work.hero.subhead} />

      <Section>
        {published.length === 0 ? (
          <EmptyState
            title="Nothing published yet."
            body="We only publish work with a measured number and the client's written consent. When the first one clears both, it appears here."
          />
        ) : (
          <div className="space-y-16">
            {published.map((cs) => (
              <article key={cs.slug} className="border-t border-line pt-10 first:border-0 first:pt-0">
                <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr]">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      {cs.isDogfood && (
                        <span className="rounded-full border border-trust/30 bg-trust-soft px-2.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-trust">
                          Our own operations
                        </span>
                      )}
                      {cs.industry && (
                        <span className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
                          {cs.industry}
                        </span>
                      )}
                    </div>

                    <h2 className="mt-4 text-2xl sm:text-3xl">{cs.headline}</h2>
                    <p className="mt-2 text-sm text-subtle">
                      {cs.client}
                      {cs.clientNote && <> · {cs.clientNote}</>}
                    </p>

                    {cs.challenge && (
                      <div className="mt-7">
                        <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
                          The problem
                        </p>
                        <p className="mt-2 max-w-prose leading-relaxed text-muted">{cs.challenge}</p>
                      </div>
                    )}

                    {cs.approach && (
                      <div className="mt-6">
                        <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
                          What we built
                        </p>
                        <p className="mt-2 max-w-prose leading-relaxed text-muted">{cs.approach}</p>
                      </div>
                    )}

                    {cs.quote && (
                      <blockquote className="mt-8 border-l-2 border-accent pl-5">
                        <p className="font-display text-lg italic leading-relaxed text-ink">
                          “{cs.quote.text}”
                        </p>
                        <footer className="mt-2 text-sm text-subtle">
                          {cs.quote.name}
                          {cs.quote.title && <>, {cs.quote.title}</>}
                        </footer>
                      </blockquote>
                    )}
                  </div>

                  <div className="space-y-7 rounded-lg border border-line bg-surface p-7 lg:self-start">
                    <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
                      Measured
                    </p>
                    {(cs.metrics ?? []).map((m) => (
                      <Stat key={m.label} value={m.value} label={m.label} note={m.note} />
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </Section>

      <CtaBand />
    </>
  );
}
