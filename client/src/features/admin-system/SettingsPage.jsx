// M1 — EC settings page (NFR-09): OTP, session, rate-limit and reminder values
// without a code change. Blocked while voting is open; every change is audited.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../app/api.js';
import { useAuth } from '../../app/auth.jsx';
import { Alert, Button, Card, FormField, Loading, PageLayout, useFetch } from '../../components/ui';

const GROUPS = ['otp', 'session', 'rateLimit', 'notify'];

export default function SettingsPage() {
  const { t } = useTranslation('system');
  const { role } = useAuth();
  const { data, error, loading } = useFetch('/admin/settings');
  const [list, setList] = useState(null);
  const [locked, setLocked] = useState(false);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [fieldError, setFieldError] = useState(null);

  useEffect(() => {
    if (!data) return;
    setList(data.settings);
    setLocked(data.locked);
  }, [data]);

  const readOnly = locked || role !== 'ec';

  const changes = useMemo(() => {
    const out = {};
    for (const s of list ?? []) {
      if (!(s.key in draft)) continue;
      const v = draft[s.key];
      if (v === null) {
        if (!s.isDefault) out[s.key] = null;
      } else if (v !== '' && Number(v) !== s.value) {
        out[s.key] = Number(v);
      }
    }
    return out;
  }, [draft, list]);

  async function save(e) {
    e.preventDefault();
    setMessage(null);
    setFieldError(null);
    setBusy(true);
    try {
      const res = await api.put('/admin/settings', { values: changes });
      setList(res.settings);
      setDraft({});
      setMessage({ tone: 'success', text: t('settings.saved') });
    } catch (err) {
      if (err.details?.key) setFieldError({ key: err.details.key, text: err.message });
      setMessage({ tone: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const valueOf = (s) => (s.key in draft ? (draft[s.key] ?? s.default) : s.value);

  return (
    <PageLayout
      title={t('settings.title')}
      subtitle={t('settings.subtitle')}
      back={role === 'ec' ? { to: '/admin', label: t('backToDashboard') } : undefined}
    >
      {loading && <Loading />}
      {error && <Alert tone="error">{error.message}</Alert>}
      {locked && (
        <Alert tone="warning" className="mb-4">
          {t('settings.locked')}
        </Alert>
      )}
      {message && (
        <Alert tone={message.tone} className="mb-4">
          {message.text}
        </Alert>
      )}

      {list && (
        <form onSubmit={save} className="space-y-4" noValidate>
          {GROUPS.map((group) => (
            <Card key={group}>
              <h2 className="mb-3 text-lg font-semibold">{t(`settings.groups.${group}`)}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {list
                  .filter((s) => s.group === group)
                  .map((s) => (
                    <div key={s.key}>
                      <FormField
                        as="input"
                        type="number"
                        inputMode="numeric"
                        min={s.min}
                        max={s.max}
                        step={1}
                        label={`${t(`settings.keys.${s.key}`)} (${t(`settings.units.${s.unit}`)})`}
                        hint={t('settings.range', { min: s.min, max: s.max, def: s.default })}
                        error={fieldError?.key === s.key ? fieldError.text : undefined}
                        value={valueOf(s)}
                        disabled={readOnly}
                        onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                      />
                      {!readOnly && !s.isDefault && draft[s.key] !== null && (
                        <button
                          type="button"
                          className="mt-1 text-sm text-brand-700 underline"
                          onClick={() => setDraft((d) => ({ ...d, [s.key]: null }))}
                        >
                          {t('settings.useDefault')}
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            </Card>
          ))}
          {!readOnly && (
            <Button type="submit" loading={busy} disabled={Object.keys(changes).length === 0}>
              {t('settings.save')}
            </Button>
          )}
        </form>
      )}
    </PageLayout>
  );
}
