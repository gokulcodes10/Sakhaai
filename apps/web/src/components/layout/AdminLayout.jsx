import { NavLink, Outlet } from 'react-router';
import { useSelector, useDispatch } from 'react-redux';
import clsx from 'clsx';
import { permissionSatisfies } from '@sakha/shared';
import { selectUser, signOut } from '../../features/auth/authSlice.js';
import { toggleTheme, selectTheme } from '../../features/ui/uiSlice.js';
import SakhaPanel from '../sakha/SakhaPanel.jsx';
import SakhaLauncher from '../sakha/SakhaLauncher.jsx';
import { Link } from 'react-router';

/**
 * Nav is permission-driven, not role-driven. When the super admin grants CMS
 * access to an admin, the Content section appears in their sidebar on the next
 * page load — no code change, no separate "admin type".
 */
const NAV = [
  { to: '/admin', end: true, label: 'Overview', requires: null },
  {
    section: 'Content',
    requires: 'cms.access',
    items: [
      { to: '/admin/content', label: 'Site content', requires: 'cms.content.read' },
      { to: '/admin/pages', label: 'Pages', requires: 'cms.content.read' },
      { to: '/admin/media', label: 'Media', requires: 'cms.media.read' },
    ],
  },
  {
    section: 'Sakha',
    requires: null,
    items: [
      { to: '/admin/knowledge', label: 'Knowledge base', requires: 'knowledge.read' },
      { to: '/admin/conversations', label: 'Conversations', requires: 'sakha.conversations.read' },
      { to: '/admin/sakha-settings', label: 'Tuning', requires: 'sakha.settings.write' },
    ],
  },
  {
    section: 'Business',
    requires: null,
    items: [{ to: '/admin/leads', label: 'Leads', requires: 'crm.leads.read' }],
  },
  {
    section: 'Administration',
    requires: null,
    items: [
      { to: '/admin/people', label: 'People & access', requires: 'iam.users.read' },
      { to: '/admin/roles', label: 'Roles', requires: 'iam.roles.read' },
      { to: '/admin/audit', label: 'Audit log', requires: 'ops.audit.read' },
    ],
  },
];

export default function AdminLayout() {
  const user = useSelector(selectUser);
  const theme = useSelector(selectTheme);
  const dispatch = useDispatch();
  const held = user?.permissions ?? [];
  const can = (p) => !p || permissionSatisfies(held, p);

  return (
    <div className="flex min-h-dvh bg-paper">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-16 items-center gap-2.5 border-b border-line px-5">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-ink font-display text-base font-semibold text-accent">
              S
            </span>
            <span className="font-display text-sm font-semibold text-ink">Sakha Admin</span>
          </Link>
        </div>

        <nav className="scroll-thin flex-1 overflow-y-auto px-3 py-5">
          {NAV.map((entry, i) => {
            if (entry.to) {
              return can(entry.requires) ? <NavItem key={entry.to} {...entry} /> : null;
            }
            if (!can(entry.requires)) return null;
            const visible = entry.items.filter((it) => can(it.requires));
            if (!visible.length) return null;
            return (
              <div key={entry.section} className={clsx(i > 0 && 'mt-6')}>
                <p className="px-3 pb-2 text-2xs font-semibold uppercase tracking-[0.12em] text-subtle">
                  {entry.section}
                </p>
                {visible.map((it) => (
                  <NavItem key={it.to} {...it} />
                ))}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-line p-3">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-ink">{user?.name}</p>
            <p className="truncate text-xs text-subtle">{user?.title ?? user?.email}</p>
          </div>
          <div className="mt-1 flex gap-1">
            <button
              type="button"
              onClick={() => dispatch(toggleTheme())}
              className="flex-1 rounded px-3 py-1.5 text-left text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            <button
              type="button"
              onClick={() => dispatch(signOut())}
              className="rounded px-3 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <Outlet />
      </div>

      <SakhaLauncher />
      <SakhaPanel />
    </div>
  );
}

function NavItem({ to, label, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx(
          'block rounded px-3 py-2 text-sm transition-colors',
          isActive ? 'bg-raised font-medium text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink'
        )
      }
    >
      {label}
    </NavLink>
  );
}

/** Consistent page chrome inside the admin. */
export function AdminPage({ title, description, actions, children }) {
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-6 sm:px-8">
          <div>
            <h1 className="font-display text-2xl font-semibold text-ink">{title}</h1>
            {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </header>
      <div className="px-6 py-8 sm:px-8">{children}</div>
    </>
  );
}
