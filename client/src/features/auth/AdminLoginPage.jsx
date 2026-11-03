// M1 — FR-02 Election Commission / Observer login (email + password).
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../app/api.js';
import { useAuth, homeFor } from '../../app/auth.jsx';
import { AuthCard, ErrorBox, InfoBox, buttonClass, inputClass, useErrorText } from './shared.jsx';

export default function AdminLoginPage() {
  const { t } = useTranslation('auth');
  const { user, role, login, expired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const errorText = useErrorText();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homeFor(role)} replace />;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await api.post('/auth/admin/login', { email: email.trim(), password });
      login(data.user);
      const home = homeFor(data.user.role);
      const from = location.state?.from?.pathname;
      navigate(from && from.startsWith(home) ? from : home, { replace: true });
    } catch (err) {
      setError(err);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t('admin.title')}>
      {expired && <InfoBox>{t('sessionExpired')}</InfoBox>}
      <form noValidate onSubmit={submit} className="mt-4">
        <label htmlFor="email" className="block font-medium">
          {t('admin.email')}
        </label>
        <input
          id="email"
          type="email"
          className={inputClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
          aria-describedby="login-error"
          aria-invalid={error ? true : undefined}
        />

        <label htmlFor="password" className="mt-4 block font-medium">
          {t('admin.password')}
        </label>
        <input
          id="password"
          type="password"
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          aria-describedby="login-error"
          aria-invalid={error ? true : undefined}
        />

        <ErrorBox id="login-error">{errorText(error)}</ErrorBox>

        <button type="submit" className={`${buttonClass} mt-5`} disabled={busy || !email || !password}>
          {busy ? t('admin.submitting') : t('admin.submit')}
        </button>
        <p className="mt-5 text-center text-sm">
          <Link to="/login" className="text-brand-700 underline">
            {t('admin.voterLink')}
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
