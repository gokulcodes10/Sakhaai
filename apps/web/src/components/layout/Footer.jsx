import { Link } from 'react-router';
import { useSelector } from 'react-redux';
import { selectContent } from '../../features/content/contentSlice.js';

export default function Footer() {
  const content = useSelector(selectContent);
  const footer = content?.footer;
  const company = content?.company;
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-line bg-surface">
      <div className="shell py-16">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_2fr]">
          <div className="max-w-sm">
            <Link to="/" className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ink font-display text-lg font-semibold text-accent">
                S
              </span>
              <span className="font-display text-base font-semibold text-ink">Sakha AI</span>
            </Link>

            <p className="mt-4 text-sm leading-relaxed text-muted">{footer?.blurb}</p>

            {company?.tagline && (
              <p className="mt-5 font-display text-lg font-semibold text-ink">{company.tagline}</p>
            )}

            <div className="mt-6 space-y-1.5 text-sm">
              {company?.email && (
                <a href={`mailto:${company.email}`} className="block text-muted transition-colors hover:text-accent">
                  {company.email}
                </a>
              )}
              {company?.phone && (
                <a href={`tel:${company.phone.replace(/\s/g, '')}`} className="block text-muted transition-colors hover:text-accent">
                  {company.phone}
                </a>
              )}
              {company?.address?.city && (
                <p className="text-subtle">
                  {[company.address.city, company.address.state, company.address.country].filter(Boolean).join(', ')}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {(footer?.columns ?? []).map((col) => (
              <div key={col.title}>
                <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
                  {col.title}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <Link to={link.href} className="text-sm text-muted transition-colors hover:text-accent">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-subtle">
            © {year} {footer?.legal?.copyright ?? 'Sakha InfoTech'}
            {footer?.legal?.registration && <> · {footer.legal.registration}</>}
          </p>
          <div className="flex items-center gap-5">
            {(footer?.legal?.links ?? []).map((l) => (
              <Link key={l.href} to={l.href} className="text-xs text-subtle transition-colors hover:text-muted">
                {l.label}
              </Link>
            ))}
            {company?.social?.linkedin && (
              <a
                href={company.social.linkedin}
                target="_blank"
                rel="noreferrer noopener"
                className="text-xs text-subtle transition-colors hover:text-muted"
              >
                LinkedIn
              </a>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
