// M3 UI kit — FormField: label + control + hint + error, wired with ids for screen readers.
//
//   <FormField label="Bio" hint="Max 1000 characters" error={errors.bio}>
//     {(props) => <textarea {...props} />}
//   </FormField>
//
// Or let it render the control:  <FormField label="Name" as="input" value=... onChange=... />
import { useId } from 'react';

export const controlClass =
  'block w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-500 disabled:bg-slate-100';

export function FormField({ label, hint, error, required, as, children, className = '', ...controlProps }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const props = {
    id,
    required,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined,
    className: `${controlClass} ${error ? 'border-red-600' : ''}`,
    ...controlProps,
  };
  let control = null;
  if (typeof children === 'function') control = children(props);
  else if (as === 'textarea') control = <textarea rows={4} {...props} />;
  else if (as === 'select') control = <select {...props}>{children}</select>;
  else if (as === 'input') control = <input {...props} />;

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-slate-800">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {control}
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="mt-1 text-sm font-medium text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

export default FormField;
