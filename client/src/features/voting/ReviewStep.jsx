// M4 — review before submitting (FR-09): every post, the choice or "left blank", and a link back to each step.
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card } from '../../components/ui';
import { positionName } from '../candidates/format.js';

export default function ReviewStep({ positions, selections, onEdit, onBack, onContinue }) {
  const { t, i18n } = useTranslation('voting');
  const blanks = positions.filter((p) => (selections[p.id] ?? []).length === 0).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-900">{t('review.title')}</h2>
        <p className="mt-1 text-slate-700">{t('review.intro')}</p>
      </div>

      {blanks > 0 && <Alert tone="warning">{t('review.blankWarning', { count: blanks })}</Alert>}

      <Card as="div" className="p-0 sm:p-0">
        <ol className="divide-y divide-slate-200">
          {positions.map((p, i) => {
            const chosen = (selections[p.id] ?? [])
              .map((id) => p.candidates.find((c) => c.id === id))
              .filter(Boolean);
            const name = positionName(p, i18n.language);
            return (
              <li key={p.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-sm text-slate-700">
                    {i + 1}. {name}
                  </p>
                  {chosen.length === 0 ? (
                    <p className="font-semibold text-slate-600">{t('review.leftBlank')}</p>
                  ) : (
                    <ul>
                      {chosen.map((c) => (
                        <li key={c.id} className="break-words font-semibold text-slate-900">
                          {c.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <Button
                  variant="secondary"
                  onClick={() => onEdit(i)}
                  aria-label={t('review.changeFor', { post: name })}
                >
                  {t('review.change')}
                </Button>
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
        <Button variant="secondary" onClick={onBack}>
          {t('review.back')}
        </Button>
        <Button onClick={onContinue}>{t('review.continue')}</Button>
      </div>
    </div>
  );
}
