import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { useDispatch, useSelector } from 'react-redux';
import clsx from 'clsx';
import { selectContent } from '../../features/content/contentSlice.js';
import { selectIsStaff, selectUser, signOut } from '../../features/auth/authSlice.js';
import { selectTheme, toggleTheme } from '../../features/ui/uiSlice.js';
import { Button } from '../ui/index.jsx';

export default function Header() {
  const content = useSelector(selectContent);
  const user = useSelector(selectUser);
  const isStaff = useSelector(selectIsStaff);
  const theme = useSelector(selectTheme);
  const dispatch = useDispatch();
  const location = useLocation();

  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const nav = content?.nav?.primary ?? [];
  const cta = content?.nav?.cta;

  return (
    <header
      className={clsx(
        'sticky top-0 z-30 border-b transition-colors duration-200',
        scrolled ? 'border-line bg-paper/85 backdrop-blur-md' : 'border-transparent bg-paper'
      )}
    >
      <div className="shell flex h-16 items-center gap-6">
        <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="Sakha AI, home">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ink font-display text-lg font-semibold text-accent">
            S
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-display text-base font-semibold text-ink">Sakha AI</span>
            <span className="mt-0.5 text-2xs uppercase tracking-[0.1em] text-subtle">
              Sakha InfoTech
            </span>
          </span>
        </Link>

        <nav className="hidden flex-1 items-center gap-1 lg:flex" aria-label="Primary">
          {nav.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              className={({ isActive }) =>
                clsx(
                  'rounded px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive ? 'text-ink' : 'text-muted hover:text-ink'
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => dispatch(toggleTheme())}
            className="rounded p-2 text-muted transition-colors hover:bg-raised hover:text-ink"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>

          {user ? (
            <div className="hidden items-center gap-2 sm:flex">
              {isStaff && (
                <Button to="/admin" variant="ghost" size="sm">
                  Admin
                </Button>
              )}
              <Button to="/portal" variant="outline" size="sm">
                {user.name.split(' ')[0]}
              </Button>
              <button
                type="button"
                onClick={() => dispatch(signOut())}
                className="rounded px-2 py-1 text-sm text-muted transition-colors hover:text-ink"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              to="/signin"
              className="hidden rounded px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:text-ink sm:block"
            >
              Sign in
            </Link>
          )}

          {cta && (
            <Button to={cta.href} variant="accent" size="sm" className="hidden sm:inline-flex">
              {cta.label}
            </Button>
          )}

          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded p-2 text-muted transition-colors hover:bg-raised hover:text-ink lg:hidden"
            aria-label="Menu"
            aria-expanded={mobileOpen}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              {mobileOpen ? (
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              ) : (
                <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-line bg-paper lg:hidden">
          <nav className="shell flex flex-col gap-1 py-4" aria-label="Mobile">
            {nav.map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                className={({ isActive }) =>
                  clsx(
                    'rounded px-3 py-2.5 text-base font-medium',
                    isActive ? 'bg-raised text-ink' : 'text-muted'
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
            <div className="mt-3 flex flex-col gap-2 border-t border-line pt-4">
              {user ? (
                <>
                  {isStaff && <Button to="/admin" variant="outline">Admin</Button>}
                  <Button to="/portal" variant="outline">Client portal</Button>
                  <Button variant="ghost" onClick={() => dispatch(signOut())}>Sign out</Button>
                </>
              ) : (
                <Button to="/signin" variant="outline">Sign in</Button>
              )}
              {cta && <Button to={cta.href} variant="accent">{cta.label}</Button>}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

const SunIcon = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M10 2v1.5M10 16.5V18M18 10h-1.5M3.5 10H2M15.7 4.3l-1 1M5.3 14.7l-1 1M15.7 15.7l-1-1M5.3 5.3l-1-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const MoonIcon = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M16.5 11.8A7 7 0 018.2 3.5a7 7 0 108.3 8.3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);
