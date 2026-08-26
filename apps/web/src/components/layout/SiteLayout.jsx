import { Outlet, useLocation } from 'react-router';
import { useSelector } from 'react-redux';
import { useEffect } from 'react';
import clsx from 'clsx';
import Header from './Header.jsx';
import Footer from './Footer.jsx';
import SakhaPanel from '../sakha/SakhaPanel.jsx';
import SakhaLauncher from '../sakha/SakhaLauncher.jsx';
import { selectSakhaOpen } from '../../features/sakha/sakhaSlice.js';

export default function SiteLayout() {
  const location = useLocation();
  const panelOpen = useSelector(selectSakhaOpen);

  // Restore scroll to the top on navigation — the browser's default restoration
  // fights a client-side router.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        Skip to content
      </a>

      {/* On a wide screen the docked panel pushes the page rather than covering
          it, so a visitor can read and interrogate simultaneously. */}
      <div className={clsx('flex flex-1 flex-col transition-[padding] duration-300 ease-out', panelOpen && 'with-panel')}>
        <Header />
        <main id="main" className="flex-1">
          <Outlet />
        </main>
        <Footer />
      </div>

      <SakhaLauncher />
      <SakhaPanel />
    </div>
  );
}
