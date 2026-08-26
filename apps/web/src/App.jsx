import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes } from 'react-router';
import { useDispatch, useSelector } from 'react-redux';

import SiteLayout from './components/layout/SiteLayout.jsx';
import { RequireAuth, RequirePermission, RequireStaff } from './components/layout/Guards.jsx';

import { loadContent, selectContentReady } from './features/content/contentSlice.js';
import { loadSession } from './features/auth/authSlice.js';
import { applyTheme, selectTheme } from './features/ui/uiSlice.js';
import { Spinner } from './components/ui/index.jsx';

import Home from './pages/Home.jsx';
import { Services, ServiceDetail } from './pages/Services.jsx';
import { Industries, IndustryDetail } from './pages/Industries.jsx';
import Pricing from './pages/Pricing.jsx';
import Work from './pages/Work.jsx';
import About from './pages/About.jsx';
import ResponsibleAi from './pages/ResponsibleAi.jsx';
import Contact from './pages/Contact.jsx';
import { ForgotPassword, ResetPassword, SignIn, SignUp } from './pages/Auth.jsx';
import Portal from './pages/portal/Portal.jsx';
import NotFound from './pages/NotFound.jsx';

// The admin is lazy-loaded. A visitor reading the pricing page should never
// download the CMS, the permission grant UI, or the knowledge-base tooling.
const AdminLayout = lazy(() => import('./components/layout/AdminLayout.jsx'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard.jsx'));
const ContentEditor = lazy(() => import('./pages/admin/ContentEditor.jsx'));
const People = lazy(() => import('./pages/admin/People.jsx'));
const Knowledge = lazy(() => import('./pages/admin/Knowledge.jsx'));
const Leads = lazy(() => import('./pages/admin/Leads.jsx'));
const Audit = lazy(() => import('./pages/admin/Misc.jsx').then((m) => ({ default: m.Audit })));
const Conversations = lazy(() => import('./pages/admin/Misc.jsx').then((m) => ({ default: m.Conversations })));
const Media = lazy(() => import('./pages/admin/Misc.jsx').then((m) => ({ default: m.Media })));
const Pages = lazy(() => import('./pages/admin/Misc.jsx').then((m) => ({ default: m.Pages })));
const Roles = lazy(() => import('./pages/admin/Misc.jsx').then((m) => ({ default: m.Roles })));
const SakhaSettings = lazy(() => import('./pages/admin/Misc.jsx').then((m) => ({ default: m.SakhaSettings })));

export default function App() {
  const dispatch = useDispatch();
  const contentReady = useSelector(selectContentReady);
  const contentError = useSelector((s) => s.content.error);
  const theme = useSelector(selectTheme);

  useEffect(() => {
    dispatch(loadContent());
    dispatch(loadSession());
  }, [dispatch]);

  // The only place the theme reaches the DOM and localStorage.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // The whole site renders from the content tree, so there is nothing sensible
  // to show until it arrives.
  if (!contentReady && !contentError) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-paper">
        <Spinner className="h-6 w-6 text-muted" />
      </div>
    );
  }

  if (contentError) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-paper px-6">
        <div className="max-w-md text-center">
          <h1 className="font-display text-2xl font-semibold text-ink">The site could not load.</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">{contentError}</p>
          <p className="mt-4 font-mono text-xs text-subtle">
            If you are running this locally, check the API is up: <code>npm run dev:api</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Auth pages sit outside the site shell — no nav, no assistant. */}
      <Route path="/signin" element={<SignIn />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route element={<SiteLayout />}>
        <Route index element={<Home />} />
        <Route path="services" element={<Services />} />
        <Route path="services/:slug" element={<ServiceDetail />} />
        <Route path="industries" element={<Industries />} />
        <Route path="industries/:slug" element={<IndustryDetail />} />
        <Route path="pricing" element={<Pricing />} />
        <Route path="work" element={<Work />} />
        <Route path="about" element={<About />} />
        <Route path="responsible-ai" element={<ResponsibleAi />} />
        <Route path="contact" element={<Contact />} />

        <Route
          path="portal"
          element={
            <RequireAuth>
              <Portal />
            </RequireAuth>
          }
        />

        <Route path="*" element={<NotFound />} />
      </Route>

      <Route
        path="/admin"
        element={
          <RequireStaff>
            <Suspense fallback={<AdminLoading />}>
              <AdminLayout />
            </Suspense>
          </RequireStaff>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="content" element={<RequirePermission permission="cms.content.read"><ContentEditor /></RequirePermission>} />
        <Route path="pages" element={<RequirePermission permission="cms.content.read"><Pages /></RequirePermission>} />
        <Route path="media" element={<RequirePermission permission="cms.media.read"><Media /></RequirePermission>} />
        <Route path="knowledge" element={<RequirePermission permission="knowledge.read"><Knowledge /></RequirePermission>} />
        <Route path="conversations" element={<RequirePermission permission="sakha.conversations.read"><Conversations /></RequirePermission>} />
        <Route path="sakha-settings" element={<RequirePermission permission="sakha.settings.write"><SakhaSettings /></RequirePermission>} />
        <Route path="leads" element={<RequirePermission permission="crm.leads.read"><Leads /></RequirePermission>} />
        <Route path="people" element={<RequirePermission permission="iam.users.read"><People /></RequirePermission>} />
        <Route path="roles" element={<RequirePermission permission="iam.roles.read"><Roles /></RequirePermission>} />
        <Route path="audit" element={<RequirePermission permission="ops.audit.read"><Audit /></RequirePermission>} />
      </Route>
    </Routes>
  );
}

function AdminLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper">
      <Spinner className="h-6 w-6 text-muted" />
    </div>
  );
}
