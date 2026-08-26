import { Link } from 'react-router';

export default function PageHero({ eyebrow, title, subhead, back, children }) {
  return (
    <section className="border-b border-line bg-surface">
      <div className="shell py-14 sm:py-18">
        {back && (
          <Link
            to={back.href}
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-accent"
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M16 10H4M9 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {back.label}
          </Link>
        )}
        {eyebrow && <p className="eyebrow mb-4">{eyebrow}</p>}
        <h1 className="max-w-3xl text-4xl sm:text-5xl">{title}</h1>
        {subhead && <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">{subhead}</p>}
        {children}
      </div>
    </section>
  );
}
