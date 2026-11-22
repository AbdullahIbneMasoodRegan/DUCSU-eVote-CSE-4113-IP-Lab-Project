// M3 — public home page: election title, status banner and links to candidates, login and nomination.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Alert, ButtonLink, Card, Loading } from '../../components/ui';
import { useAuth, homeFor } from '../../app/auth.jsx';
import StatusBanner from './StatusBanner.jsx';
import { useElection } from './useElection.js';

export default function HomePage() {
  const { t } = useTranslation('public');
  const { user, role } = useAuth();
  const { data: election, error, loading } = useElection();
  const isVoter = role === 'voter' || role === 'candidate';
  // 404 NO_ELECTION is normal before the EC sets one up; anything else is a real error.
  const noElection = error?.status === 404;

  return (
    <div className="space-y-5">
      <Card>
        <h1 className="text-2xl font-bold text-brand-800">{t('home.title')}</h1>
        <p className="mt-1 text-sm text-slate-700">{t('home.tagline')}</p>
        <p className="mt-3 text-slate-800">{t('home.body')}</p>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          {user ? (
            <ButtonLink to={homeFor(role)}>{t('home.myPage')}</ButtonLink>
          ) : (
            <ButtonLink to="/login">{t('home.loginCta')}</ButtonLink>
          )}
          {isVoter && (
            <ButtonLink to="/nomination" variant="secondary">
              {role === 'candidate' ? t('home.myNomination') : t('home.nominateCta')}
            </ButtonLink>
          )}
          <ButtonLink to="/candidates" variant="secondary">{t('home.browseCandidates')}</ButtonLink>
          <ButtonLink to="/panels" variant="secondary">{t('home.browsePanels')}</ButtonLink>
        </div>
        {!user && (
          <p className="mt-4 text-center text-sm sm:text-left">
            <Link to="/admin/login" className="text-brand-700 underline">{t('home.adminCta')}</Link>
          </p>
        )}
      </Card>

      {loading && <Loading />}
      {!loading && error && !noElection && <Alert tone="error">{t('home.electionLoadError')}</Alert>}
      {!loading && (noElection || election) && <StatusBanner election={noElection ? null : election} />}
    </div>
  );
}
