// M3 — <CandidateProfile id={12} /> : full public profile of one candidate.
// M4 opens it inside <Modal> on the ballot, so it has no page chrome and no links that leave the page
// unless `showLinks` is true.
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Avatar, Badge, Loading } from '../../components/ui';
import { useFetch } from '../../components/ui/useFetch.js';
import { positionName } from './format.js';

const STATUS_TONE = { pending: 'warning', approved: 'success', rejected: 'danger' };

export default function CandidateProfile({ id, showLinks = false }) {
  const { t, i18n } = useTranslation('candidates');
  const { data: c, error, loading } = useFetch(id ? `/candidates/${id}` : null);

  if (loading) return <Loading label={t('common:loading', { defaultValue: 'Loading…' })} />;
  if (error || !c) {
    return (
      <Alert tone="error">{error?.status === 404 ? t('profile.notFound') : t('loadError')}</Alert>
    );
  }

  return (
    <article className="space-y-4">
      <header className="flex items-center gap-4">
        <Avatar src={c.photoUrl} name={c.name} size={88} alt={t('profile.photoAlt', { name: c.name })} />
        <div className="min-w-0">
          <h2 className="break-words text-xl font-bold text-slate-900">{c.name}</h2>
          <p className="text-slate-700">{positionName(c.position, i18n.language)}</p>
          {c.status && (
            <Badge tone={STATUS_TONE[c.status]} className="mt-1">
              {t(`profile.status.${c.status}`)}
            </Badge>
          )}
        </div>
      </header>

      {c.status && c.status !== 'approved' && <Alert tone="info">{t('profile.previewNote')}</Alert>}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-slate-800">{t('profile.panel')}</dt>
          <dd className="text-slate-700">
            {c.panel ? (
              showLinks ? (
                <Link to={`/panels/${c.panel.id}`} className="text-brand-700 underline">
                  {c.panel.name}
                </Link>
              ) : (
                c.panel.name
              )
            ) : (
              t('profile.independent')
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-800">{t('profile.hall')}</dt>
          <dd className="text-slate-700">{c.hall}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-semibold text-slate-800">{t('profile.department')}</dt>
          <dd className="text-slate-700">{c.department}</dd>
        </div>
      </dl>

      {c.bio && (
        <section>
          <h3 className="font-semibold text-slate-900">{t('profile.bio')}</h3>
          <p className="mt-1 whitespace-pre-line break-words text-slate-800">{c.bio}</p>
        </section>
      )}
      {c.manifesto && (
        <section>
          <h3 className="font-semibold text-slate-900">{t('profile.manifesto')}</h3>
          <p className="mt-1 whitespace-pre-line break-words text-slate-800">{c.manifesto}</p>
        </section>
      )}
    </article>
  );
}
