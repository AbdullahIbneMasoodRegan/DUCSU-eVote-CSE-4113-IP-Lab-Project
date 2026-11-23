// M3 — /candidates : approved candidates grouped by post, in ballot order (FR-07, basic).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Avatar, Button, ButtonLink, Card, FormField, Loading, PageLayout } from '../../components/ui';
import { useFetch } from '../../components/ui/useFetch.js';
import { positionName } from './format.js';

export default function CandidateListPage() {
  const { t, i18n } = useTranslation('candidates');
  const [positionId, setPositionId] = useState('');
  const { data, error, loading, reload } = useFetch('/candidates');

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

  const groups = data.filter((g) => !positionId || String(g.position.id) === positionId);
  const total = data.reduce((n, g) => n + g.candidates.length, 0);

  return (
    <PageLayout
      title={t('list.title')}
      subtitle={t('list.intro')}
      actions={
        <ButtonLink to="/panels" variant="secondary">
          {t('list.panelsLink')}
        </ButtonLink>
      }
    >
      <FormField label={t('list.filterPosition')} as="select" value={positionId} onChange={(e) => setPositionId(e.target.value)} className="mb-5 max-w-md">
        <option value="">{t('list.allPositions')}</option>
        {data.map((g) => (
          <option key={g.position.id} value={g.position.id}>
            {g.position.displayOrder}. {positionName(g.position, i18n.language)}
          </option>
        ))}
      </FormField>

      {total === 0 && <Alert tone="info">{t('list.noCandidates')}</Alert>}

      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.position.id} aria-labelledby={`pos-${g.position.id}`}>
            <h2 id={`pos-${g.position.id}`} className="mb-2 text-lg font-bold text-slate-900">
              {g.position.displayOrder}. {positionName(g.position, i18n.language)}
            </h2>
            {g.candidates.length === 0 ? (
              <p className="text-sm text-slate-600">{t('list.noCandidates')}</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {g.candidates.map((c) => (
                  <li key={c.id}>
                    <Card as="div" className="h-full !p-3">
                      <Link
                        to={`/candidates/${c.id}`}
                        aria-label={t('list.viewProfile', { name: c.name })}
                        className="flex items-center gap-3"
                      >
                        <Avatar src={c.photoUrl} name={c.name} size={56} />
                        <span className="min-w-0">
                          <span className="block break-words font-semibold text-brand-800 underline">
                            {c.name}
                          </span>
                          <span className="block text-sm text-slate-700">
                            {c.panel ? c.panel.name : t('list.independent')}
                          </span>
                        </span>
                      </Link>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </PageLayout>
  );
}
