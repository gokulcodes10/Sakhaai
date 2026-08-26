import { useSelector } from 'react-redux';
import { selectContent } from '../features/content/contentSlice.js';
import { Section, SectionHeading } from '../components/ui/index.jsx';
import Seo from '../components/layout/Seo.jsx';
import PageHero from '../components/layout/PageHero.jsx';
import { CtaBand } from './Services.jsx';

export default function ResponsibleAi() {
  const content = useSelector(selectContent);
  if (!content) return null;
  const r = content.responsibleAi;

  return (
    <>
      <Seo title={r.meta?.title} description={r.meta?.description} />
      <PageHero eyebrow={r.hero.eyebrow} title={r.hero.headline} subhead={r.hero.subhead} />

      <Section>
        <SectionHeading
          eyebrow="Autonomy"
          title="Every agent starts supervised and earns the rest."
          body="Nervous is a reasonable way to start. You choose the level, it is written into the scope, and moving up needs evidence rather than a nudge from us."
        />

        <ol className="mt-14 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {r.autonomyLevels.map((lvl) => (
            <li key={lvl.level} className="bg-surface p-6">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-3xl font-semibold text-accent">{lvl.level}</span>
                <span className="font-display text-lg font-semibold text-ink">{lvl.name}</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted">{lvl.description}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section tone="trust">
        <div className="max-w-2xl">
          <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-white/60">
            The checklist
          </p>
          <h2 className="mt-4 text-3xl text-white sm:text-4xl">
            Ten items. Every proposal. No exceptions.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-white/75">
            Enterprise buyers ask for this and most small firms have nothing to hand them.
            Writing it down cost us an afternoon.
          </p>
        </div>

        <ol className="mt-14 grid gap-x-10 gap-y-7 md:grid-cols-2">
          {r.checklist.map((item, i) => (
            <li key={item.item} className="flex gap-4">
              <span className="font-mono text-xs text-white/40">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <p className="font-medium leading-snug text-white">{item.item}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-white/60">{item.why}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <CtaBand />
    </>
  );
}
