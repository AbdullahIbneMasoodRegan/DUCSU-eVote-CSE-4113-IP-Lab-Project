// M3 — nomination form (FR-05): post, short bio, manifesto. Used to create and to edit.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, FormField } from '../../components/ui';
import { api } from '../../app/api.js';
import { errorMessage, positionName } from './format.js';

const BIO_MAX = 1000;
const MANIFESTO_MAX = 5000;

export default function NominationForm({ positions, nomination, onSaved }) {
  const { t, i18n } = useTranslation('candidates');
  const editing = Boolean(nomination);
  const [positionId, setPositionId] = useState(nomination ? String(nomination.position.id) : '');
  const [bio, setBio] = useState(nomination?.bio ?? '');
  const [manifesto, setManifesto] = useState(nomination?.manifesto ?? '');
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null); // { tone, text }
  const [busy, setBusy] = useState(false);

  function validate() {
    const next = {};
    const required = t('nomination.form.required');
    if (!positionId) next.positionId = required;
    if (!bio.trim()) next.bio = required;
    if (!manifesto.trim()) next.manifesto = required;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setMessage(null);
    if (!validate()) return;
    setBusy(true);
    try {
      const body = { positionId: Number(positionId), bio: bio.trim(), manifesto: manifesto.trim() };
      if (editing) await api.patch('/nominations/me', body);
      else await api.post('/nominations', body);
      setMessage({ tone: 'success', text: t(editing ? 'nomination.form.saved' : 'nomination.form.created') });
      onSaved?.();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(t, 'nomination.errors', err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <FormField
        label={t('nomination.form.position')}
        as="select"
        required
        value={positionId}
        error={errors.positionId}
        onChange={(e) => setPositionId(e.target.value)}
      >
        <option value="">{t('nomination.form.positionPlaceholder')}</option>
        {positions.map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayOrder}. {positionName(p, i18n.language)}
          </option>
        ))}
      </FormField>
      <FormField
        label={t('nomination.form.bio')}
        as="textarea"
        required
        rows={3}
        maxLength={BIO_MAX}
        value={bio}
        error={errors.bio}
        hint={t('nomination.form.bioHint', { max: BIO_MAX })}
        onChange={(e) => setBio(e.target.value)}
      />
      <FormField
        label={t('nomination.form.manifesto')}
        as="textarea"
        required
        rows={6}
        maxLength={MANIFESTO_MAX}
        value={manifesto}
        error={errors.manifesto}
        hint={t('nomination.form.manifestoHint', { max: MANIFESTO_MAX })}
        onChange={(e) => setManifesto(e.target.value)}
      />
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <Button type="submit" loading={busy}>
        {editing ? t('nomination.form.save') : t('nomination.form.submit')}
      </Button>
    </form>
  );
}
