// M4 — one post per screen (FR-08).
// Selections live in the parent's React state only: never localStorage, sessionStorage, URLs or analytics.
// The maximum is enforced here for a good experience; the server enforces it again (NFR-05).
import { useTranslation } from 'react-i18next';
import { Alert, Avatar, Button, Card } from '../../components/ui';
import { positionName } from '../candidates/format.js';

function CandidateOption({ candidate, post, checked, disabled, onToggle, onProfile }) {
  const { t } = useTranslation('voting');
  const single = post.maxSelections === 1;
  return (
    <li>
      <label
        className={`flex items-start gap-3 rounded-lg border p-3 ${
          checked ? 'border-brand-700 bg-brand-50 ring-2 ring-brand-700' : 'border-slate-300 bg-white'
        } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-slate-50'}`}
      >
        <input
          type={single ? 'radio' : 'checkbox'}
          name={`post-${post.id}`}
          checked={checked}
          disabled={disabled}
          onChange={() => onToggle(candidate.id)}
          className="mt-1 h-5 w-5 shrink-0 accent-brand-700"
        />
        <Avatar src={candidate.photoUrl} name={candidate.name} size={56} />
        <span className="min-w-0 flex-1">
          <span className="block break-words font-semibold text-slate-900">{candidate.name}</span>
          <span className="block text-sm text-slate-700">{candidate.panel?.name ?? t('step.independent')}</span>
          <span className="block text-sm text-slate-600">{candidate.hall}</span>
        </span>
      </label>
      <Button variant="ghost" className="mt-1" onClick={() => onProfile(candidate)}>
        {t('step.viewProfile', { name: candidate.name })}
      </Button>
    </li>
  );
}

export default function BallotStep({
  post,
  index,
  total,
  selected,
  onChange,
  onProfile,
  onBack,
  onNext,
  returnToReview,
  onBackToReview,
}) {
  const { t, i18n } = useTranslation('voting');
  const max = post.maxSelections;
  const single = max === 1;
  const full = selected.length >= max;
  const isLast = index === total - 1;

  function toggle(candidateId) {
    if (single) return onChange([candidateId]);
    if (selected.includes(candidateId)) return onChange(selected.filter((id) => id !== candidateId));
    if (full) return undefined; // maximum reached: the browser never lets a third one in
    return onChange([...selected, candidateId]);
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-slate-800" aria-live="polite">
          {t('step.post', { current: index + 1, total })}
        </p>
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={index + 1}
          aria-label={t('step.post', { current: index + 1, total })}
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-300"
        >
          <div className="h-full bg-brand-700" style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>
      </div>

      <Card>
        <h2 className="text-xl font-bold text-slate-900">{positionName(post, i18n.language)}</h2>
        <p className="mt-1 text-slate-700">
          {single ? t('step.chooseOne') : t('step.chooseUpTo', { count: max })}
        </p>
        {!single && (
          <p className="mt-1 text-sm font-semibold text-slate-800" aria-live="polite">
            {t('step.selected', { selected: selected.length, max })}
          </p>
        )}

        {post.candidates.length === 0 ? (
          <Alert tone="info" className="mt-4">
            {t('step.noCandidates')}
          </Alert>
        ) : (
          <fieldset className="mt-4">
            <legend className="sr-only">{t('step.candidates')}</legend>
            <ul className="space-y-3">
              {post.candidates.map((c) => {
                const checked = selected.includes(c.id);
                return (
                  <CandidateOption
                    key={c.id}
                    candidate={c}
                    post={post}
                    checked={checked}
                    disabled={!single && full && !checked}
                    onToggle={toggle}
                    onProfile={onProfile}
                  />
                );
              })}
            </ul>
            {!single && full && (
              <Alert tone="info" className="mt-3">
                {t('step.limitReached')}
              </Alert>
            )}
          </fieldset>
        )}

        {selected.length > 0 && (
          <Button variant="ghost" className="mt-3" onClick={() => onChange([])}>
            {t('step.clear')}
          </Button>
        )}
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row">
          {index > 0 && !returnToReview && (
            <Button variant="secondary" onClick={onBack}>
              {t('step.back')}
            </Button>
          )}
          {selected.length === 0 && (
            <Button
              variant="secondary"
              onClick={returnToReview ? onBackToReview : onNext}
              aria-label={t('step.skip')}
            >
              {t('step.skip')}
            </Button>
          )}
        </div>
        {returnToReview ? (
          <Button onClick={onBackToReview}>{t('step.backToReview')}</Button>
        ) : (
          <Button onClick={onNext}>{isLast ? t('step.toReview') : t('step.next')}</Button>
        )}
      </div>
    </div>
  );
}
