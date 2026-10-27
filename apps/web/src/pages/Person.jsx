import { Navigate, useParams } from 'react-router';
import { useDispatch, useSelector } from 'react-redux';
import { selectContent } from '../features/content/contentSlice.js';
import { openPanel } from '../features/sakha/sakhaSlice.js';
import { Badge, Button, Section, SectionHeading } from '../components/ui/index.jsx';
import Seo, { SITE_URL } from '../components/layout/Seo.jsx';
import PageHero from '../components/layout/PageHero.jsx';
import Lifecycle from '../components/about/Lifecycle.jsx';
import { CtaBand } from './Services.jsx';

/**
 * A founder's profile at /about/:slug.
 *
 * This is the page a search for the person's name should land on, so it
 * carries schema.org Person data and puts the evidence — the lifecycle ledger,
 * the reference, the timeline — in plain, crawlable text rather than images.
 */
export default function Person() {
  const { slug } = useParams();
  const dispatch = useDispatch();
  const content = useSelector(selectContent);
  if (!content) return null;

  const person = (content.about.team ?? []).find((p) => p.slug === slug);
  if (!person) return <Navigate to="/about" replace />;

  const { record } = person;
  const first = person.name.split(' ')[0];

  return (
    <>
      <Seo title={person.name} description={record?.summary ?? person.bio} jsonLd={personLd(person, content)} />
      <PageHero
        eyebrow={person.role}
        title={person.name}
        subhead={record?.summary ?? person.bio}
        back={{ href: '/about', label: 'About Asphalix' }}
      />

      <Section>
        <div className="grid gap-12 lg:grid-cols-[1fr_1.3fr]">
          {person.photo && (
            <img src={person.photo} alt={person.name} className="aspect-[4/3] w-full rounded-xl object-cover" />
          )}
          <div>
            {person.bio && <p className="font-display text-xl leading-relaxed text-ink">{person.bio}</p>}
            {person.talkTo?.length > 0 && (
              <div className="mt-8 border-t border-line pt-7">
                <p className="font-mono text-2xs uppercase tracking-wider text-subtle">Talk to {first} about</p>
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
            <div className="mt-8 flex flex-wrap gap-3">
              {person.email && (
                <Button href={`mailto:${person.email}`} variant="accent">
                  Email {first}
                </Button>
              )}
              {person.linkedin && (
                <Button href={person.linkedin} variant="outline" target="_blank" rel="noreferrer noopener">
                  LinkedIn
                </Button>
              )}
              {person.github && (
                <Button href={person.github} variant="outline" target="_blank" rel="noreferrer noopener">
                  GitHub
                </Button>
              )}
            </div>
          </div>
        </div>
      </Section>

      {record?.lifecycle?.length > 0 && (
        <Section tone="surface" id="lifecycle">
          <SectionHeading
            eyebrow={record.headline ?? 'Engineering record'}
            title="Plan to production, stage by stage."
            body="Pick a stage to see the evidence behind it. Each line says where it comes from."
          />
          <div className="mt-12">
            <Lifecycle stages={record.lifecycle} sources={record.sources} />
          </div>
        </Section>
      )}

      {record?.projects?.length > 0 && (
        <Section id="projects">
          <SectionHeading eyebrow="Shipped" title="Systems in daily use, and the research behind them." />
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {record.projects.map((p) => (
              <article key={p.name} className="flex flex-col rounded-lg border border-line bg-paper p-7">
                <p className="font-mono text-2xs uppercase tracking-wider text-subtle">{p.kind}</p>
                <h3 className="mt-2 text-xl">{p.name}</h3>
                <p className="mt-3 leading-relaxed text-muted">{p.body}</p>
                {p.stack?.length > 0 && (
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-5">
                    {p.stack.map((s) => (
                      <Badge key={s} className="normal-case tracking-normal">
                        {s}
                      </Badge>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </Section>
      )}

      {record?.reference?.quotes?.length > 0 && (
        <Section tone="surface" id="reference">
          <SectionHeading eyebrow="In someone else's words" title="From a letter of recommendation." />
          <figure className="mt-12 max-w-3xl">
            <div className="space-y-6 border-l-2 border-accent pl-6 sm:pl-8">
              {record.reference.quotes.map((q) => (
                <blockquote key={q} className="font-display text-xl leading-relaxed text-ink">
                  “{q}”
                </blockquote>
              ))}
            </div>
            <figcaption className="mt-8 pl-6 sm:pl-8">
              <p className="font-medium text-ink">{record.reference.name}</p>
              <p className="text-muted">{record.reference.title}</p>
              <p className="mt-2 font-mono text-2xs uppercase tracking-wider text-subtle">
                {[record.reference.date, record.reference.letterRef && `Ref. ${record.reference.letterRef}`]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {record.reference.note && <p className="mt-3 text-sm text-muted">{record.reference.note}</p>}
            </figcaption>
          </figure>
        </Section>
      )}

      {(record?.timeline?.length > 0 || record?.skills?.length > 0) && (
        <Section>
          <div className="grid gap-14 lg:grid-cols-[1.3fr_1fr]">
            {record.timeline?.length > 0 && (
              <div>
                <h2 className="text-3xl">Where the experience comes from</h2>
                <ol className="mt-10 space-y-8 border-l border-line">
                  {record.timeline.map((t) => (
                    <li key={`${t.period}-${t.title}`} className="relative pl-7">
                      <span aria-hidden="true" className="absolute -left-[5px] top-2 h-2.5 w-2.5 rounded-full bg-accent" />
                      <p className="font-mono text-2xs uppercase tracking-wider text-subtle">{t.period}</p>
                      <h3 className="mt-1.5 text-lg">{t.title}</h3>
                      <p className="text-accent">{t.org}</p>
                      {t.body && <p className="mt-2 leading-relaxed text-muted">{t.body}</p>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {record.skills?.length > 0 && (
              <div>
                <h2 className="text-3xl">What {first} works in</h2>
                <dl className="mt-10 space-y-6">
                  {record.skills.map((g) => (
                    <div key={g.group}>
                      <dt className="font-mono text-2xs uppercase tracking-wider text-subtle">{g.group}</dt>
                      <dd className="mt-2.5 flex flex-wrap gap-2">
                        {g.items.map((item) => (
                          <Badge key={item} className="normal-case tracking-normal">
                            {item}
                          </Badge>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </Section>
      )}

      {record && (
        <Section tone="surface">
          <SectionHeading
            eyebrow="Check it yourself"
            title="The best evidence is running on this page."
            body={`Sakha, the assistant in the corner, is ${first}'s work: retrieval over our own documents, tool calls, and handoff to a person when it should not answer. Ask it something hard.`}
          />
          <div className="mt-8 flex flex-wrap gap-3">
            <Button variant="accent" onClick={() => dispatch(openPanel())}>
              Try Sakha
            </Button>
            {person.email && (
              <Button
                href={`mailto:${person.email}?subject=${encodeURIComponent('Letter of recommendation')}`}
                variant="outline"
              >
                Request the full letter
              </Button>
            )}
          </div>
        </Section>
      )}

      <CtaBand />
    </>
  );
}

function personLd(person, content) {
  const url = `${SITE_URL}/about/${person.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${url}#person`,
    name: person.name,
    jobTitle: person.role,
    url,
    ...(person.photo && { image: new URL(person.photo, SITE_URL).href }),
    ...((person.linkedin || person.github) && { sameAs: [person.linkedin, person.github].filter(Boolean) }),
    worksFor: { '@type': 'Organization', name: content.company?.brandName ?? 'Asphalix', url: SITE_URL },
    ...(person.record?.skills && { knowsAbout: person.record.skills.flatMap((g) => g.items) }),
    ...(person.record?.summary && { description: person.record.summary }),
  };
}
