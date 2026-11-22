// M3 UI kit — PageLayout: consistent page heading, optional back link and actions.
import { Link } from 'react-router-dom';

export function PageLayout({ title, subtitle, back, actions, children }) {
  return (
    <div>
      {back && (
        <Link to={back.to} className="mb-3 inline-block text-sm text-brand-700 underline">
          ← {back.label}
        </Link>
      )}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-brand-800">{title}</h1>
          {subtitle && <p className="mt-1 text-slate-700">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export default PageLayout;
