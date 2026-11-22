// M3 UI kit — Stepper: "Step 2 of 4" progress for multi-step flows (M4 uses it for the ballot).
//
//   <Stepper steps={['Position', 'Photo', 'Review']} current={1} />   // current is 0-based
import { useTranslation } from 'react-i18next';

export function Stepper({ steps, current, className = '' }) {
  const { t } = useTranslation('ui');
  const total = steps.length;
  return (
    <nav aria-label={t('stepper.label')} className={className}>
      <p className="text-sm font-semibold text-slate-800">
        {t('stepper.progress', { current: current + 1, total })}
        <span className="sr-only">: {steps[current]}</span>
      </p>
      <ol className="mt-2 flex gap-1" role="list">
        {steps.map((label, i) => (
          <li
            key={label}
            aria-current={i === current ? 'step' : undefined}
            className={`h-2 flex-1 rounded-full ${i < current ? 'bg-brand-700' : i === current ? 'bg-brand-600' : 'bg-slate-300'}`}
            title={label}
          >
            <span className="sr-only">{label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default Stepper;
