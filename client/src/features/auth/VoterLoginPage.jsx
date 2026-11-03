// M1 — FR-01 voter login: registration number -> 6-digit email code.
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../app/api.js';
import { useAuth, homeFor } from '../../app/auth.jsx';
import { AuthCard, ErrorBox, InfoBox, buttonClass, inputClass, useErrorText } from './shared.jsx';

const REG_NO = /^[A-Za-z0-9-]{3,32}$/;

export function useCountdown() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return undefined;
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds]);
  return [seconds, setSeconds];
}

export default function VoterLoginPage() {
  const { t, i18n } = useTranslation('auth');
  const { user, role, login, expired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const errorText = useErrorText();

  const [step, setStep] = useState('regNo');
  const [regNo, setRegNo] = useState('');
  const [code, setCode] = useState('');
  const [minutes, setMinutes] = useState(5);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useCountdown();
  const codeRef = useRef(null);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  if (user) return <Navigate to={homeFor(role)} replace />;

  async function sendCode({ resend = false } = {}) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const data = await api.post('/auth/otp/request', { regNo: regNo.trim(), lang: i18n.language });
      setMinutes(Math.round(data.expiresInSeconds / 60));
      setSecondsLeft(data.resendAfterSeconds);
      setCode('');
      setStep('code');
      if (resend) setNotice(t('voter.resent'));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const data = await api.post('/auth/otp/verify', { regNo: regNo.trim(), code });
      login(data.user);
      const from = location.state?.from?.pathname;
      navigate(from && from.startsWith('/voter') ? from : homeFor(data.user.role), { replace: true });
    } catch (err) {
      setError(err);
      setCode('');
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const regNoValid = REG_NO.test(regNo.trim());

  return (
    <AuthCard title={t('voter.title')}>
      {expired && <InfoBox>{t('sessionExpired')}</InfoBox>}

      {step === 'regNo' ? (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (regNoValid) sendCode();
          }}
          className="mt-4"
        >
          <p className="text-slate-700">{t('voter.intro')}</p>
          <label htmlFor="regNo" className="mt-5 block font-medium">
            {t('voter.regNo')}
          </label>
          <input
            id="regNo"
            name="regNo"
            className={inputClass}
            value={regNo}
            onChange={(e) => setRegNo(e.target.value)}
            autoComplete="username"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            maxLength={32}
            required
            aria-describedby="regNo-hint login-error"
            aria-invalid={error ? true : undefined}
          />
          <p id="regNo-hint" className="mt-1 text-sm text-slate-600">
            {t('voter.regNoHint')}
          </p>
          <ErrorBox id="login-error">{errorText(error)}</ErrorBox>
          <button type="submit" className={`${buttonClass} mt-5`} disabled={busy || !regNoValid}>
            {busy ? t('voter.sending') : t('voter.sendCode')}
          </button>
          <p className="mt-5 text-center text-sm">
            <Link to="/admin/login" className="text-brand-700 underline">
              {t('admin.title')}
            </Link>
          </p>
        </form>
      ) : (
        <form noValidate onSubmit={verify} className="mt-4">
          <h2 className="font-semibold">{t('voter.codeTitle')}</h2>
          <p className="mt-1 text-slate-700">{t('voter.codeSent', { regNo: regNo.trim(), minutes })}</p>

          <label htmlFor="code" className="mt-5 block font-medium">
            {t('voter.code')}
          </label>
          <input
            id="code"
            name="code"
            ref={codeRef}
            className={`${inputClass} text-center text-2xl tracking-[0.5em]`}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            aria-describedby="code-hint login-error"
            aria-invalid={error ? true : undefined}
          />
          <p id="code-hint" className="mt-1 text-sm text-slate-600">
            {t('voter.neverShare')}
          </p>

          <ErrorBox id="login-error">{errorText(error)}</ErrorBox>
          <InfoBox>{notice}</InfoBox>

          <button type="submit" className={`${buttonClass} mt-5`} disabled={busy || code.length !== 6}>
            {busy ? t('voter.verifying') : t('voter.verify')}
          </button>

          <div className="mt-5 flex flex-col items-center gap-3 text-sm">
            {secondsLeft > 0 ? (
              <p className="text-slate-600" aria-live="off">
                {t('voter.resendIn', { seconds: secondsLeft })}
              </p>
            ) : (
              <button
                type="button"
                className="text-brand-700 underline disabled:text-slate-400"
                onClick={() => sendCode({ resend: true })}
                disabled={busy}
              >
                {t('voter.resend')}
              </button>
            )}
            <button
              type="button"
              className="text-slate-700 underline"
              onClick={() => {
                setStep('regNo');
                setError(null);
                setNotice(null);
              }}
            >
              {t('voter.changeNumber')}
            </button>
          </div>
        </form>
      )}
    </AuthCard>
  );
}
