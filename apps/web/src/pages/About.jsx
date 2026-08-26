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

      <Section>
        <SectionHeading eyebrow="The team" title="Three people. All of them reachable." />
        <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {[...about.team]
            .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
            .map((person) => (
              <article key={person.slug} className="rounded-lg border border-line bg-surface p-7">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ink font-display text-xl font-semibold text-accent">
                  {initials(person.name)}
                </div>
                <h3 className="mt-5 text-lg">{person.name}</h3>
                <p className="mt-1 text-sm text-accent">{person.role}</p>
                {person.bio && <p className="mt-4 text-sm leading-relaxed text-muted">{person.bio}</p>}
                <div className="mt-5 flex flex-wrap gap-4 text-sm">
                  {person.email && (
                    <a href={`mailto:${person.email}`} className="text-muted transition-colors hover:text-accent">
                      Email
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
              </article>
            ))}
        </div>
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
