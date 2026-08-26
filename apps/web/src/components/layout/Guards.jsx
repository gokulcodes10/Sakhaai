import { Navigate, useLocation } from 'react-router';
import { useSelector } from 'react-redux';
import { permissionSatisfies } from '@sakha/shared';
import { selectAuthReady, selectUser } from '../../features/auth/authSlice.js';
import { Spinner } from '../ui/index.jsx';

/**
 * Route guards. These are a UX convenience, not a security boundary — every
 * endpoint behind them re-checks on the server. Their job is to stop someone
 * landing on an empty admin screen full of 403s.
 */

function Waiting() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner className="h-6 w-6 text-muted" />
    </div>
  );
}

export function RequireAuth({ children }) {
  const ready = useSelector(selectAuthReady);
  const user = useSelector(selectUser);
  const location = useLocation();

  if (!ready) return <Waiting />;
  if (!user) return <Navigate to="/signin" state={{ from: location.pathname }} replace />;
  return children;
}

/** Staff area. Anyone whose roles are not purely "client". */
export function RequireStaff({ children }) {
  const ready = useSelector(selectAuthReady);
  const user = useSelector(selectUser);

  if (!ready) return <Waiting />;
  if (!user) return <Navigate to="/signin" replace />;
  if (!(user.roles ?? []).some((r) => r !== 'client')) return <Navigate to="/portal" replace />;
  return children;
}

export function RequirePermission({ permission, children }) {
  const ready = useSelector(selectAuthReady);
  const user = useSelector(selectUser);

  if (!ready) return <Waiting />;
  if (!user) return <Navigate to="/signin" replace />;
  if (!permissionSatisfies(user.permissions ?? [], permission)) {
    return (
      <div className="px-6 py-20 text-center sm:px-8">
        <h1 className="font-display text-2xl font-semibold text-ink">Not your area.</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
          You need <code className="font-mono text-xs text-accent">{permission}</code> to open this.
          A super admin can grant it from People &amp; access.
        </p>
      </div>
    );
  }
  return children;
}
