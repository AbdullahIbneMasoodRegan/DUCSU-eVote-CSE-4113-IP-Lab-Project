// M1 — small pieces shared by the two login pages.
// TODO(M1): switch to M3's components/ui (Button, Card, FormField) once merged.
import { useTranslation } from 'react-i18next';
import { formatDhakaTime } from '../../i18n/index.js';

export const inputClass =
  'mt-1 block w-full rounded-md border border-slate-400 bg-white px-3 py-3 text-base ' +
  'focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/30 ' +
  'aria-[invalid=true]:border-red-700';

export const buttonClass =
  'w-full rounded-md bg-brand-700 px-4 py-3 text-base font-semibold text-white ' +
  'hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-slate-400';

export function AuthCard({ title, children }) {
  return (
    <section className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h1 className="text-xl font-bold text-brand-800">{title}</h1>
      {children}
    </section>
  );
}

/** Error message for an ApiError, in the current language. */
export function useErrorText() {
  const { t } = useTranslation('auth');
  return (err) => {
    if (!err) return null;
    if (err.code === 'OTP_COOLDOWN') {
      const at = err.details?.retryAt;
      return t('errors.OTP_COOLDOWN', {
        time: at ? formatDhakaTime(at, { timeStyle: 'short' }) : '15 min',
      });
    }
    const key = `errors.${err.code}`;
    const msg = t(key);
    return msg === key ? t('errors.generic') : msg;
  };
}

export function ErrorBox({ children, id }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
      {children}
    </p>
  );
}

export function InfoBox({ children }) {
  if (!children) return null;
  return (
    <p role="status" className="mt-4 rounded-md border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-800">
      {children}
    </p>
  );
}
