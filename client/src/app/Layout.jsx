// M1 — page shell: header (brand, language switch, user + logout) and footer.
// Mobile-first: everything fits at 360 px.
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, homeFor } from './auth.jsx';
import { setLanguage } from '../i18n/index.js';

export default function Layout() {
  const { t, i18n } = useTranslation('common');
  const { user, role, logout } = useAuth();
  const navigate = useNavigate();
  const other = i18n.language === 'bn' ? 'en' : 'bn';

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="bg-brand-800 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
          <Link to="/" className="text-lg font-bold tracking-tight">
            {t('appName')}
          </Link>
          <nav aria-label={t('nav.mainMenu')} className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setLanguage(other)}
              lang={other}
              aria-label={`${t('language.label')}: ${t('language.switchTo')}`}
              className="rounded border border-white/40 px-2 py-1 hover:bg-white/10"
            >
              {t('language.switchTo')}
            </button>
            {user ? (
              <>
                <Link
                  to={homeFor(role)}
                  className="hidden rounded px-2 py-1 hover:bg-white/10 sm:inline"
                  title={t('loggedInAs', { name: user.name ?? '' })}
                >
                  {t('nav.dashboard')}
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded bg-white px-2 py-1 font-medium text-brand-800 hover:bg-brand-50"
                >
                  {t('nav.logout')}
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="rounded bg-white px-2 py-1 font-medium text-brand-800 hover:bg-brand-50"
              >
                {t('nav.login')}
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <p className="mx-auto max-w-5xl px-4 py-4 text-xs text-slate-600">{t('footer')}</p>
      </footer>
    </div>
  );
}
