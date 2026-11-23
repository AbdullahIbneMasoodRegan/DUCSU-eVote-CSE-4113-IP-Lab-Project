// M4 — the public receipt list with a search box (FR-12). Published only after voting closes.
// Anyone can search for their code to confirm their ballot was counted; codes say nothing about voters.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Card, FormField, Loading, PageLayout } from '../../components/ui';
import { useFetch } from '../../components/ui/useFetch.js';

export default function PublicReceiptsPage() {
  const { t } = useTranslation('voting');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const { data, error, loading } = useFetch(`/receipts?q=${encodeURIComponent(debounced)}`);
  const closedYet = error?.code !== 'VOTING_NOT_CLOSED';

  return (
    <PageLayout title={t('receipts.title')} subtitle={t('receipts.intro')}>
      {!closedYet ? (
        <Alert tone="info">{t('receipts.notClosed')}</Alert>
      ) : (
        <Card className="space-y-4">
          <FormField
            label={t('receipts.searchLabel')}
            hint={t('receipts.searchHint')}
            as="input"
            type="search"
            value={q}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(e) => setQ(e.target.value)}
          />
          {error && <Alert tone="error">{t('receipts.loadError')}</Alert>}
          {loading && !data && <Loading label={t('loading')} />}
          {data && (
            <>
              <p className="text-sm font-semibold text-slate-800" aria-live="polite">
                {t('receipts.count', { count: data.count })}
              </p>
              {data.count === 0 ? (
                <p className="text-slate-700">{t('receipts.none')}</p>
              ) : (
                <ul
                  aria-label={t('receipts.listLabel')}
                  className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-sm text-slate-900 sm:grid-cols-3"
                >
                  {data.codes.map((code) => (
                    <li key={code}>{code}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>
      )}
    </PageLayout>
  );
}
