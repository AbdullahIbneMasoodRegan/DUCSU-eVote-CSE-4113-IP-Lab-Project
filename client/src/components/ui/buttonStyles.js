// M3 UI kit — shared button classes (also used for links that look like buttons).
const base =
  'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md px-4 py-2 text-center text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60';

const variants = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800',
  secondary: 'border border-slate-400 bg-white text-slate-900 hover:bg-slate-100',
  danger: 'bg-red-700 text-white hover:bg-red-800',
  ghost: 'text-brand-700 underline hover:bg-brand-50',
};

export const buttonClass = (variant = 'primary', extra = '') =>
  `${base} ${variants[variant] ?? variants.primary} ${extra}`.trim();
