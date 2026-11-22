// M3 UI kit — Card, Badge, Alert, Avatar, Loading.
import { createElement } from 'react';

export function Card({ as = 'section', className = '', children, ...rest }) {
  return createElement(
    as,
    { className: `rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${className}`, ...rest },
    children,
  );
}

const badgeTones = {
  neutral: 'bg-slate-100 text-slate-800',
  success: 'bg-green-100 text-green-900',
  warning: 'bg-amber-100 text-amber-900',
  danger: 'bg-red-100 text-red-900',
  info: 'bg-blue-100 text-blue-900',
};

export function Badge({ tone = 'neutral', children, className = '' }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeTones[tone]} ${className}`}>
      {children}
    </span>
  );
}

const alertTones = {
  info: 'border-blue-300 bg-blue-50 text-blue-950',
  success: 'border-green-300 bg-green-50 text-green-950',
  warning: 'border-amber-300 bg-amber-50 text-amber-950',
  error: 'border-red-300 bg-red-50 text-red-950',
};

export function Alert({ tone = 'info', title, children, className = '' }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-md border px-4 py-3 text-sm ${alertTones[tone]} ${className}`}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
    </div>
  );
}

/** Photo, or the person's initials when there is none. Decorative unless `alt` is given. */
export function Avatar({ src, name = '', size = 56, alt = '', className = '' }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0])
    .join('')
    .toUpperCase();
  const style = { width: size, height: size, minWidth: size };
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        style={style}
        className={`rounded-full border border-slate-200 bg-slate-100 object-cover ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ ...style, fontSize: size / 2.6 }}
      className={`inline-flex items-center justify-center rounded-full bg-brand-100 font-bold text-brand-800 ${className}`}
    >
      {initials || '?'}
    </span>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <p className="py-10 text-center text-slate-600" role="status">
      {label}
    </p>
  );
}
