import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useDispatch, useSelector } from 'react-redux';
import { clearAuthError, selectUser, signIn, signUp } from '../features/auth/authSlice.js';
import api, { ApiError } from '../lib/api.js';
import { Alert, Button, Field, Input } from '../components/ui/index.jsx';
import Seo from '../components/layout/Seo.jsx';

/** Shared two-column shell: form on the left, the argument on the right. */
function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="grid min-h-[calc(100dvh-4rem)] lg:grid-cols-2">
      <div className="flex items-center justify-center px-5 py-16 sm:px-10">
        <div className="w-full max-w-sm">
          <h1 className="text-3xl">{title}</h1>
          {subtitle && <p className="mt-3 leading-relaxed text-muted">{subtitle}</p>}
          <div className="mt-9">{children}</div>
          {footer && <div className="mt-8 text-sm text-muted">{footer}</div>}
        </div>
      </div>

      <div className="hidden flex-col justify-center border-l border-line bg-ink px-14 py-16 lg:flex">
        <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-accent">
          Sakha means friend
        </p>
        <p className="mt-6 max-w-md font-display text-3xl leading-tight text-paper">
          Trust. Grit. Agents that ship.
        </p>
        <p className="mt-6 max-w-md leading-relaxed text-paper/60">
          Signed-in clients see live project status, the metric each agent is being
          measured against, and every document we have handed over — and Sakha can
          answer questions about all of it.
        </p>
      </div>
    </div>
  );
}

export function SignIn() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const user = useSelector(selectUser);
  const { signingIn, error, fieldErrors } = useSelector((s) => s.auth);
  const [values, setValues] = useState({ email: '', password: '' });

  useEffect(() => () => dispatch(clearAuthError()), [dispatch]);

  if (user) return <Navigate to={user.roles?.includes('client') ? '/portal' : '/admin'} replace />;

  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const result = await dispatch(signIn(values));
    if (signIn.fulfilled.match(result)) {
      const roles = result.payload?.roles ?? [];
      navigate(roles.some((r) => r !== 'client') ? '/admin' : '/portal', { replace: true });
    }
  }

  return (
    <>
      <Seo title="Sign in" noindex />
      <AuthShell
        title="Sign in"
        subtitle="For clients and the Sakha AI team."
        footer={
          <>
            No account yet?{' '}
            <Link to="/signup" className="font-medium text-accent hover:underline">
              Create one
            </Link>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-5" noValidate>
          {error && <Alert tone="error">{error}</Alert>}

          <Field label="Email" error={fieldErrors.email}>
            <Input type="email" value={values.email} onChange={set('email')} autoComplete="email" required autoFocus />
          </Field>

          <Field label="Password" error={fieldErrors.password}>
            <Input type="password" value={values.password} onChange={set('password')} autoComplete="current-password" required />
          </Field>

          <div className="flex items-center justify-between">
            <Link to="/forgot-password" className="text-sm text-muted hover:text-accent">
              Forgot your password?
            </Link>
          </div>

          <Button type="submit" variant="accent" size="lg" className="w-full" loading={signingIn}>
            Sign in
          </Button>
        </form>
      </AuthShell>
    </>
  );
}

export function SignUp() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const user = useSelector(selectUser);
  const { signingIn, error, fieldErrors } = useSelector((s) => s.auth);
  const [values, setValues] = useState({ name: '', email: '', company: '', password: '', website: '' });

  useEffect(() => () => dispatch(clearAuthError()), [dispatch]);
  if (user) return <Navigate to="/portal" replace />;

  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const result = await dispatch(signUp(values));
    if (signUp.fulfilled.match(result)) navigate('/portal', { replace: true });
  }

  return (
    <>
      <Seo title="Create an account" noindex />
      <AuthShell
        title="Create an account"
        subtitle="Client accounts see project status, documents and the metric we agreed."
        footer={
          <>
            Already have one?{' '}
            <Link to="/signin" className="font-medium text-accent hover:underline">
              Sign in
            </Link>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-5" noValidate>
          {error && <Alert tone="error">{error}</Alert>}

          <Field label="Your name" error={fieldErrors.name}>
            <Input value={values.name} onChange={set('name')} autoComplete="name" required autoFocus />
          </Field>
          <Field label="Work email" error={fieldErrors.email}>
            <Input type="email" value={values.email} onChange={set('email')} autoComplete="email" required />
          </Field>
          <Field label="Company" error={fieldErrors.company}>
            <Input value={values.company} onChange={set('company')} autoComplete="organization" />
          </Field>
          <Field
            label="Password"
            hint="At least 10 characters, with an uppercase letter and a number."
            error={fieldErrors.password}
          >
            <Input type="password" value={values.password} onChange={set('password')} autoComplete="new-password" required />
          </Field>

          <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden opacity-0">
            <input tabIndex={-1} autoComplete="off" value={values.website} onChange={set('website')} />
          </div>

          <Button type="submit" variant="accent" size="lg" className="w-full" loading={signingIn}>
            Create account
          </Button>
        </form>
      </AuthShell>
    </>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    await api.post('/auth/forgot-password', { email }).catch(() => {});
    setBusy(false);
    setSent(true);
  }

  return (
    <>
      <Seo title="Reset your password" noindex />
      <AuthShell
        title="Reset your password"
        subtitle={sent ? null : 'We will email you a link. It works once and expires in an hour.'}
        footer={
          <Link to="/signin" className="font-medium text-accent hover:underline">
            Back to sign in
          </Link>
        }
      >
        {sent ? (
          <Alert tone="success" title="Check your email.">
            If that address has an account, a reset link is on its way.
          </Alert>
        ) : (
          <form onSubmit={submit} className="space-y-5" noValidate>
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="email" />
            </Field>
            <Button type="submit" variant="accent" size="lg" className="w-full" loading={busy}>
              Send the link
            </Button>
          </form>
        )}
      </AuthShell>
    </>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password });
      navigate('/signin?reset=1', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset that password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Seo title="Choose a new password" noindex />
      <AuthShell title="Choose a new password" subtitle="This signs you out everywhere else.">
        {!token ? (
          <Alert tone="error">
            That link is missing its token. Request a new one from{' '}
            <Link to="/forgot-password" className="underline">
              the reset page
            </Link>
            .
          </Alert>
        ) : (
          <form onSubmit={submit} className="space-y-5" noValidate>
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="New password" hint="At least 10 characters, with an uppercase letter and a number.">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus autoComplete="new-password" />
            </Field>
            <Button type="submit" variant="accent" size="lg" className="w-full" loading={busy}>
              Set the new password
            </Button>
          </form>
        )}
      </AuthShell>
    </>
  );
}
