// M3 UI kit — Button and ButtonLink. 44 px minimum touch target, visible focus (index.css).
import { Link } from 'react-router-dom';

import { buttonClass } from './buttonStyles.js';

export function Button({ variant = 'primary', loading = false, disabled, className, children, type = 'button', ...rest }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ButtonLink({ to, variant = 'primary', className, children, ...rest }) {
  return (
    <Link to={to} className={buttonClass(variant, className)} {...rest}>
      {children}
    </Link>
  );
}

export default Button;
