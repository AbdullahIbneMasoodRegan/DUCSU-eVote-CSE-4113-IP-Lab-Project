// M1 — TEMPORARY pages so every role has somewhere to land after login.
// Each owner replaces their placeholder's route in App.jsx with the real page:
//   HomePlaceholder     -> M3 features/public
//   VoterPlaceholder    -> M4 features/voting (and M3 candidate dashboard)
//   AdminPlaceholder    -> M2 features/admin
//   ObserverPlaceholder -> M3 features/observer
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './auth.jsx';

function Card({ children }) {
  return <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">{children}</section>;
}

export function HomePlaceholder() {
  const { t } = useTranslation('common');
  return (
    <Card>
      <h1 className="text-2xl font-bold text-brand-800">{t('placeholder.home.title')}</h1>
      <p className="mt-1 text-sm text-slate-600">{t('tagline')}</p>
      <p className="mt-4 text-slate-700">{t('placeholder.home.body')}</p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Link
          to="/login"
          className="rounded-md bg-brand-700 px-4 py-3 text-center font-semibold text-white hover:bg-brand-800"
        >
          {t('placeholder.home.voterCta')}
        </Link>
        <Link to="/admin/login" className="text-center text-sm text-brand-700 underline">
          {t('placeholder.home.adminCta')}
        </Link>
      </div>
    </Card>
  );
}

function RolePage({ title }) {
  const { t } = useTranslation('common');
  const { user, role } = useAuth();
  return (
    <Card>
      <h1 className="text-xl font-bold text-brand-800">{title}</h1>
      <p className="mt-2 text-slate-700">
        {t('loggedInAs', { name: user?.name ?? '' })} · {t(`roles.${role}`)}
      </p>
      <p className="mt-4 text-sm text-slate-600">{t('placeholder.comingSoon')}</p>
    </Card>
  );
}

export function VoterPlaceholder() {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  return <RolePage title={t('placeholder.voter.title', { name: user?.name ?? '' })} />;
}

export function AdminPlaceholder() {
  const { t } = useTranslation('common');
  return <RolePage title={t('placeholder.admin.title')} />;
}

export function ObserverPlaceholder() {
  const { t } = useTranslation('common');
  return <RolePage title={t('placeholder.observer.title')} />;
}

export function NotFound() {
  const { t } = useTranslation('common');
  return (
    <div className="py-16 text-center">
      <h1 className="text-xl font-semibold">{t('notFound.title')}</h1>
      <p className="mt-2 text-slate-600">{t('notFound.body')}</p>
      <Link to="/" className="mt-4 inline-block text-brand-700 underline">
        {t('notFound.back')}
      </Link>
    </div>
  );
}
