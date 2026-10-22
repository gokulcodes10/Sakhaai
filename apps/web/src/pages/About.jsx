import { useSelector } from 'react-redux';
import { selectContent } from '../features/content/contentSlice.js';
import { Section, SectionHeading } from '../components/ui/index.jsx';
import Seo from '../components/layout/Seo.jsx';
import PageHero from '../components/layout/PageHero.jsx';
import { CtaBand } from './Services.jsx';

export default function About() {
  const content = useSelector(selectContent);
  if (!content) return null;
  const { about } = content;

  return (
    <>
      <Seo title={about.meta?.title} description={about.meta?.description} />
      <PageHero eyebrow={about.hero.eyebrow} title={about.hero.headline} subhead={about.hero.subhead} />

      <Section id="founders-desk" tone="surface">
        <SectionHeading
          eyebrow={about.foundersDesk?.eyebrow ?? "Founders' desk"}
          title={about.foundersDesk?.headline ?? 'Two founders. Both of them reachable.'}
          body={about.foundersDesk?.subhead}
        />
        <div className="mt-14 grid gap-8 lg:grid-cols-2">
          {[...about.team]
            .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
            .map((person) => (
              <article
                key={person.slug}
                className="flex flex-col overflow-hidden rounded-xl border border-line bg-paper"
              >
                {person.photo ? (
                  <img
                    src={person.photo}
                    alt={person.name}
                    className="aspect-[4/3] w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-[4/3] w-full items-center justify-center bg-ink font-display text-7xl font-semibold text-accent">
                    {initials(person.name)}
                  </div>
                )}
                <div className="flex flex-1 flex-col p-8 sm:p-10">
                  <h3 className="text-3xl sm:text-4xl">{person.name}</h3>
                  <p className="mt-2 text-lg text-accent">{person.role}</p>
                  {person.bio && <p className="mt-6 text-lg leading-relaxed text-muted">{person.bio}</p>}
                  {person.talkTo?.length > 0 && (
                    <div className="mt-8 border-t border-line pt-7">
                      <p className="font-mono text-2xs uppercase tracking-wider text-subtle">
                        Talk to {person.name.split(' ')[0]} about
                      </p>
                      <ul className="mt-4 space-y-2.5 text-base text-ink">
                        {person.talkTo.map((topic) => (
                          <li key={topic} className="flex gap-3">
                            <span aria-hidden="true" className="text-accent">—</span>
                            {topic}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-auto flex flex-wrap gap-x-6 gap-y-3 pt-8 text-base">
                    {person.email && (
                      <a href={`mailto:${person.email}`} className="text-ink transition-colors hover:text-accent">
                        {person.email}
                      </a>
                    )}
                    {person.linkedin && (
                      <a
                        href={person.linkedin}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-muted transition-colors hover:text-accent"
                      >
                        LinkedIn
                      </a>
                    )}
                  </div>
                </div>
              </article>
            ))}
        </div>
      </Section>

      <Section>
        <div className="grid gap-14 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <h2 className="text-3xl">{about.story.headline}</h2>
          </div>
          <div className="space-y-6">
            {about.story.body.map((para, i) => (
              <p
                key={i}
                className={
                  i === 0
                    ? 'font-display text-xl leading-relaxed text-ink'
                    : 'leading-relaxed text-muted'
                }
              >
                {para}
              </p>
            ))}
          </div>
        </div>
      </Section>

      <Section tone="surface">
        <SectionHeading eyebrow="How we work" title="Five things we will not trade away." />
        <ol className="mt-14 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {about.principles.map((p, i) => (
            <li key={p.title} className="bg-paper p-7">
              <span className="font-mono text-2xs text-subtle">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="mt-3 text-lg">{p.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-muted">{p.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <CtaBand />
    </>
  );
}

const initials = (name) =>
  name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
