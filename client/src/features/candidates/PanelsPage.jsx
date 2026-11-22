// M3 — /panels and /panels/:id (FR-05 public side)
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Avatar, Badge, Button, Card, Loading, PageLayout } from '../../components/ui';
import { useFetch } from '../../components/ui/useFetch.js';
import { positionName } from './format.js';

function PanelLogo({ panel, size }) {
  const { t } = useTranslation('candidates');
  return (
    <Avatar src={panel.logoUrl} name={panel.name} size={size} alt={t('panels.logoAlt', { name: panel.name })} />
  );
}

export function PanelsPage() {
  const { t } = useTranslation('candidates');
  const { data, error, loading, reload } = useFetch('/panels');
  if (loading) return <Loading label={t('common:loading', { defaultValue: 'Loading…' })} />;
  if (error) {
    return (
      <Alert tone="error">
        <p>{t('loadError')}</p>
        <Button variant="secondary" className="mt-2" onClick={reload}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }
  return (
    <PageLayout title={t('panels.title')} subtitle={t('panels.intro')} back={{ to: '/candidates', label: t('profile.back') }}>
      {data.length === 0 && <Alert tone="info">{t('panels.empty')}</Alert>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {data.map((p) => (
          <li key={p.id}>
            <Card as="div" className="h-full">
              <Link to={`/panels/${p.id}`} aria-label={t('panels.viewPanel', { name: p.name })} className="flex items-center gap-3">
                <PanelLogo panel={p} size={56} />
                <span className="min-w-0">
                  <span className="block break-words text-lg font-bold text-brand-800 underline">{p.name}</span>
                  {p.slogan && <span className="block text-sm text-slate-700">{p.slogan}</span>}
                  <span className="mt-1 block text-xs text-slate-600">{t('panels.memberCount', { count: p.memberCount })}</span>
                </span>
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </PageLayout>
  );
}

export function PanelDetailPage() {
  const { t, i18n } = useTranslation('candidates');
  const { id } = useParams();
  const { data: p, error, loading } = useFetch(`/panels/${id}`);
  if (loading) return <Loading label={t('common:loading', { defaultValue: 'Loading…' })} />;
  if (error || !p) {
    return <Alert tone="error">{error?.status === 404 ? t('panels.notFound') : t('loadError')}</Alert>;
  }
  return (
    <PageLayout title={p.name} subtitle={p.slogan} back={{ to: '/panels', label: t('panels.back') }}>
      <Card className="mb-5">
        <div className="flex items-center gap-4">
          <PanelLogo panel={p} size={88} />
          <p className="text-sm text-slate-700">{t('panels.memberCount', { count: p.memberCount })}</p>
        </div>
        {p.manifesto && (
          <div className="mt-4">
            <h2 className="font-semibold text-slate-900">{t('panels.manifesto')}</h2>
            <p className="mt-1 whitespace-pre-line break-words text-slate-800">{p.manifesto}</p>
          </div>
        )}
      </Card>
      <h2 className="mb-2 text-lg font-bold text-slate-900">{t('panels.members')}</h2>
      {p.members.length === 0 && <p className="text-sm text-slate-600">{t('panels.noMembers')}</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {p.members.map((m) => (
          <li key={m.id}>
            <Card as="div" className="!p-3">
              <Link to={`/candidates/${m.id}`} className="flex items-center gap-3">
                <Avatar src={m.photoUrl} name={m.name} size={48} />
                <span className="min-w-0">
                  <span className="block break-words font-semibold text-brand-800 underline">{m.name}</span>
                  <span className="block text-sm text-slate-700">{positionName(m.position, i18n.language)}</span>
                  {m.status && m.status !== 'approved' && (
                    <Badge tone="warning" className="mt-1">{t('panels.pendingMember')}</Badge>
                  )}
                </span>
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </PageLayout>
  );
}

export default PanelsPage;
