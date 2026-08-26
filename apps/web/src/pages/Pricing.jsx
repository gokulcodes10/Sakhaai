import { useState } from 'react';
import { useSelector } from 'react-redux';
import clsx from 'clsx';
import { selectContent } from '../features/content/contentSlice.js';
import { Button, Section, SectionHeading } from '../components/ui/index.jsx';
import Seo from '../components/layout/Seo.jsx';
import PageHero from '../components/layout/PageHero.jsx';

export default function Pricing() {
  const content = useSelector(selectContent);
  if (!content) return null;
  const { pricing } = content;

  return (
    <>
      <Seo title={pricing.meta?.title} description={pricing.meta?.description} />
      <PageHero eyebrow={pricing.hero.eyebrow} title={pricing.hero.headline} subhead={pricing.hero.subhead} />

      <Section>
        {pricing.currencyNote && (
          <p className="mb-8 font-mono text-xs text-subtle">{pricing.currencyNote}</p>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {pricing.tiers.map((tier) => (
            <article
              key={tier.slug}
              className={clsx(
                'flex flex-col rounded-lg border p-7 transition-shadow',
                tier.featured
                  ? 'border-accent bg-accent-soft/30 shadow-card lg:-my-3 lg:py-10'
                  : 'border-line bg-surface'
              )}
            >
              {tier.badge && (
                <span className="mb-4 self-start rounded-full bg-accent px-2.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-accent-ink">
                  {tier.badge}
                </span>
              )}

              <h2 className="text-xl">{tier.name}</h2>
              <p className="mt-2 text-sm leading-snug text-muted">{tier.tagline}</p>

              <p className="mt-6 font-display text-4xl font-semibold leading-none text-ink">
                {tier.priceDisplay}
              </p>
              <p className="mt-2 text-sm text-subtle">{tier.duration}</p>

              {tier.bestFor && (
                <p className="mt-6 border-l-2 border-accent pl-3.5 text-sm leading-relaxed text-ink">
                  {tier.bestFor}
                </p>
              )}

              <ul className="mt-7 flex-1 space-y-2.5">
                {(tier.includes ?? []).map((item) => (
                  <li key={item} className="flex gap-2.5 text-sm leading-snug text-muted">
                    <Check />
                    {item}
                  </li>
                ))}
                {(tier.notIncluded ?? []).map((item) => (
                  <li key={item} className="flex gap-2.5 text-sm leading-snug text-subtle">
                    <Cross />
                    {item}
                  </li>
                ))}
              </ul>

              <Button
                to={tier.cta?.href ?? '/contact'}
                variant={tier.featured ? 'accent' : 'outline'}
                className="mt-8 w-full"
              >
                {tier.cta?.label ?? 'Get in touch'}
              </Button>
            </article>
          ))}
        </div>
      </Section>

      {pricing.managed?.enabled && (
        <Section tone="surface">
          <SectionHeading
            eyebrow={pricing.managed.eyebrow}
            title={pricing.managed.headline}
            body={pricing.managed.body}
          />
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {pricing.managed.plans.map((plan) => (
              <div key={plan.name} className="rounded-lg border border-line bg-paper p-7">
                <h3 className="text-lg">{plan.name}</h3>
                <p className="mt-4 font-display text-2xl font-semibold text-ink">{plan.price}</p>
                <p className="mt-1 text-sm text-subtle">{plan.priceNote}</p>
                <ul className="mt-6 space-y-2.5">
                  {plan.includes.map((i) => (
                    <li key={i} className="flex gap-2.5 text-sm leading-snug text-muted">
                      <Check />
                      {i}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      {pricing.faq?.length > 0 && (
        <Section>
          <SectionHeading eyebrow="Questions" title="The ones we actually get asked" />
          <div className="mt-12 max-w-3xl divide-y divide-line border-y border-line">
            {pricing.faq.map((item, i) => (
              <Faq key={i} question={item.q} answer={item.a} defaultOpen={i === 0} />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function Faq({ question, answer, defaultOpen }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-6 py-5 text-left"
      >
        <span className="font-display text-lg font-semibold text-ink">{question}</span>
        <svg
          width="18"
          height="18"
          viewBox="0 0 20 20"
          fill="none"
          className={clsx('mt-1 shrink-0 text-subtle transition-transform duration-200', open && 'rotate-45')}
          aria-hidden="true"
        >
          <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
      {open && <p className="max-w-prose pb-6 leading-relaxed text-muted">{answer}</p>}
    </div>
  );
}

const Check = () => (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" className="mt-0.5 shrink-0 text-accent" aria-hidden="true">
    <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Cross = () => (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" className="mt-0.5 shrink-0 text-subtle" aria-hidden="true">
    <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);
