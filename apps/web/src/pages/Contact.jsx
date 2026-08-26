import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router';
import { leadSchema } from '@sakha/shared';
import { selectContent } from '../features/content/contentSlice.js';
import { openPanel } from '../features/sakha/sakhaSlice.js';
import api, { ApiError } from '../lib/api.js';
import { Alert, Button, Field, Input, Section, Select, Textarea } from '../components/ui/index.jsx';
import Seo from '../components/layout/Seo.jsx';
import PageHero from '../components/layout/PageHero.jsx';

const BUDGET_OPTIONS = [
  { value: '', label: 'Select a range' },
  { value: 'pilot', label: 'Pilot — around ₹1.5L to ₹4L' },
  { value: 'single', label: 'One workflow in production — ₹5L to ₹12L' },
  { value: 'multi', label: 'Multiple workflows — ₹12L and up' },
  { value: 'unsure', label: 'Not sure yet' },
];

export default function Contact() {
  const content = useSelector(selectContent);
  const dispatch = useDispatch();
  const [params] = useSearchParams();

  const [values, setValues] = useState({
    name: '',
    email: '',
    company: '',
    phone: '',
    workflow: '',
    budgetTier: params.get('tier') ?? '',
    website: '', // honeypot
  });
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error
  const [serverError, setServerError] = useState(null);

  if (!content) return null;
  const { contact, company } = content;

  const set = (key) => (e) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    setServerError(null);

    // Same schema the API validates with, so the form and the endpoint agree.
    const parsed = leadSchema.safeParse({ ...values, source: 'contact-page' });
    if (!parsed.success) {
      const fieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.');
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setStatus('sending');
    try {
      await api.post('/leads', parsed.data);
      setStatus('sent');
    } catch (err) {
      setStatus('error');
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setServerError(err.message);
      } else {
        setServerError('Something went wrong. Email hello@sakhaai.com and we will pick it up there.');
      }
    }
  }

  if (status === 'sent') {
    return (
      <>
        <Seo title={contact.meta?.title} description={contact.meta?.description} noindex />
        <Section>
          <div className="mx-auto max-w-xl py-20 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
              <svg width="26" height="26" viewBox="0 0 20 20" fill="none" className="text-success" aria-hidden="true">
                <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1 className="mt-7 text-3xl">{contact.form.successTitle}</h1>
            <p className="mt-4 leading-relaxed text-muted">{contact.form.successBody}</p>
            <Button to="/" variant="outline" className="mt-9">
              Back to the site
            </Button>
          </div>
        </Section>
      </>
    );
  }

  return (
    <>
      <Seo title={contact.meta?.title} description={contact.meta?.description} />
      <PageHero eyebrow={contact.hero.eyebrow} title={contact.hero.headline} subhead={contact.hero.subhead} />

      <Section>
        <div className="grid gap-14 lg:grid-cols-[1.3fr_1fr]">
          <form onSubmit={submit} noValidate className="space-y-6">
            {serverError && <Alert tone="error">{serverError}</Alert>}

            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="Your name" required error={errors.name}>
                <Input value={values.name} onChange={set('name')} error={errors.name} autoComplete="name" />
              </Field>
              <Field label="Email" required error={errors.email}>
                <Input type="email" value={values.email} onChange={set('email')} error={errors.email} autoComplete="email" />
              </Field>
              <Field label="Company" error={errors.company}>
                <Input value={values.company} onChange={set('company')} error={errors.company} autoComplete="organization" />
              </Field>
              <Field label="Phone" hint="Optional" error={errors.phone}>
                <Input type="tel" value={values.phone} onChange={set('phone')} error={errors.phone} autoComplete="tel" />
              </Field>
            </div>

            <Field
              label={contact.form.workflowLabel}
              hint={contact.form.workflowHelp}
              error={errors.workflow}
              required
            >
              <Textarea
                rows={6}
                value={values.workflow}
                onChange={set('workflow')}
                error={errors.workflow}
                placeholder={contact.form.workflowPlaceholder}
              />
            </Field>

            <Field label={contact.form.budgetLabel} hint={contact.form.budgetHelp} error={errors.budgetTier}>
              <Select value={values.budgetTier} onChange={set('budgetTier')}>
                {BUDGET_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>

            {/* Honeypot — visually hidden, never announced, bots fill it. */}
            <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden opacity-0">
              <label>
                Website
                <input
                  tabIndex={-1}
                  autoComplete="off"
                  value={values.website}
                  onChange={set('website')}
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Button type="submit" variant="accent" size="lg" loading={status === 'sending'}>
                {contact.form.submitLabel}
              </Button>
              <p className="text-xs text-subtle">{company?.responsePromise}</p>
            </div>

            <p className="text-xs leading-relaxed text-subtle">{contact.form.consent}</p>
          </form>

          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
              Or reach us directly
            </p>
            {(contact.alternatives ?? []).map((alt) =>
              alt.action === 'open-assistant' ? (
                <button
                  key={alt.label}
                  type="button"
                  onClick={() => dispatch(openPanel())}
                  className="block w-full rounded-lg border border-line bg-surface p-5 text-left transition-colors hover:border-accent/40 hover:bg-accent-soft"
                >
                  <p className="text-sm font-medium text-ink">{alt.label}</p>
                  <p className="mt-1 text-sm text-muted">{alt.value}</p>
                </button>
              ) : (
                <a
                  key={alt.label}
                  href={alt.href}
                  target={alt.href?.startsWith('http') ? '_blank' : undefined}
                  rel="noreferrer noopener"
                  className="block rounded-lg border border-line bg-surface p-5 transition-colors hover:border-accent/40 hover:bg-accent-soft"
                >
                  <p className="text-sm font-medium text-ink">{alt.label}</p>
                  <p className="mt-1 text-sm text-muted">{alt.value}</p>
                </a>
              )
            )}
          </aside>
        </div>
      </Section>
    </>
  );
}
