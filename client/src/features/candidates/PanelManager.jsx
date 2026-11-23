// M3 — panel section of the nomination page (FR-05):
//   create a panel (name, slogan, logo, joint manifesto) · join one · stand as independent ·
//   the creator edits the panel, removes members or disbands it.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, FormField, Loading, Modal } from '../../components/ui';
import { useFetch } from '../../components/ui/useFetch.js';
import { api } from '../../app/api.js';
import { errorMessage } from './format.js';
import PhotoUploader from './PhotoUploader.jsx';

function useAction(t, onChanged) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function run(fn, success) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      if (success) setNotice(success);
      await onChanged?.();
      return true;
    } catch (err) {
      setError(errorMessage(t, 'panelManager.errors', err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, notice, run };
}

function CreatePanelForm({ t, onChanged }) {
  const [name, setName] = useState('');
  const [slogan, setSlogan] = useState('');
  const [manifesto, setManifesto] = useState('');
  const [nameError, setNameError] = useState('');
  const { busy, error, run } = useAction(t, onChanged);

  async function onSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return setNameError(t('nomination.form.required'));
    setNameError('');
    return run(() => api.post('/panels', { name: name.trim(), slogan: slogan.trim(), manifesto: manifesto.trim() }));
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      <h3 className="font-semibold text-slate-900">{t('panelManager.createHeading')}</h3>
      <p className="text-sm text-slate-700">{t('panelManager.createIntro')}</p>
      <FormField label={t('panelManager.name')} as="input" required maxLength={80} value={name} error={nameError} onChange={(e) => setName(e.target.value)} />
      <FormField label={t('panelManager.slogan')} as="input" maxLength={160} value={slogan} onChange={(e) => setSlogan(e.target.value)} />
      <FormField label={t('panelManager.manifesto')} as="textarea" rows={4} maxLength={5000} value={manifesto} onChange={(e) => setManifesto(e.target.value)} />
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" loading={busy}>{t('panelManager.create')}</Button>
    </form>
  );
}

function OwnPanel({ t, panelId, onChanged, selfCandidateId }) {
  const { data: panel, loading, reload } = useFetch(`/panels/${panelId}`);
  const [name, setName] = useState(null);
  const [slogan, setSlogan] = useState(null);
  const [manifesto, setManifesto] = useState(null);
  const [confirmDisband, setConfirmDisband] = useState(false);
  const { busy, error, notice, run } = useAction(t, async () => {
    await reload();
    await onChanged?.();
  });

  if (loading && !panel) return <Loading />;
  if (!panel) return null;

  const form = {
    name: name ?? panel.name,
    slogan: slogan ?? panel.slogan ?? '',
    manifesto: manifesto ?? panel.manifesto ?? '',
  };

  return (
    <div className="space-y-5">
      <h3 className="font-semibold text-slate-900">{t('panelManager.yourPanel')}: {panel.name}</h3>
      <form
        noValidate
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => api.patch(`/panels/${panel.id}`, form), t('nomination.form.saved'));
        }}
      >
        <FormField label={t('panelManager.name')} as="input" required maxLength={80} value={form.name} onChange={(e) => setName(e.target.value)} />
        <FormField label={t('panelManager.slogan')} as="input" maxLength={160} value={form.slogan} onChange={(e) => setSlogan(e.target.value)} />
        <FormField label={t('panelManager.manifesto')} as="textarea" rows={4} maxLength={5000} value={form.manifesto} onChange={(e) => setManifesto(e.target.value)} />
        <Button type="submit" loading={busy}>{t('panelManager.edit')}</Button>
      </form>

      <PhotoUploader
        path={`/panels/${panel.id}/logo`}
        currentUrl={panel.logoUrl}
        name={panel.name}
        heading={t('panelManager.logo')}
        uploadLabel={t('panelManager.logoUpload')}
        errorScope="panelManager.errors"
        onUploaded={reload}
      />

      <div>
        <h3 className="font-semibold text-slate-900">{t('panelManager.members')}</h3>
        <ul className="mt-2 divide-y divide-slate-200 rounded-md border border-slate-200">
          {panel.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0 break-words text-sm text-slate-900">
                {m.name}
                {m.id === selfCandidateId && <Badge className="ml-2">{t('panelManager.creator')}</Badge>}
                {m.status && m.status !== 'approved' && (
                  <Badge tone="warning" className="ml-2">{t(`nomination.status.${m.status}`)}</Badge>
                )}
              </span>
              {m.id !== selfCandidateId && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  aria-label={t('panelManager.remove', { name: m.name })}
                  onClick={() => run(() => api.delete(`/panels/${panel.id}/members/${m.id}`))}
                >
                  {t('panelManager.removeShort')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      <Button variant="danger" onClick={() => setConfirmDisband(true)}>{t('panelManager.disband')}</Button>
      <Modal
        open={confirmDisband}
        onClose={() => setConfirmDisband(false)}
        title={t('panelManager.disbandTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDisband(false)}>{t('panelManager.cancel')}</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                const ok = await run(() => api.delete(`/panels/${panel.id}`));
                if (ok) setConfirmDisband(false);
              }}
            >
              {t('panelManager.disbandConfirm')}
            </Button>
          </>
        }
      >
        <p>{t('panelManager.disbandBody')}</p>
      </Modal>
    </div>
  );
}

export default function PanelManager({ nomination, ownedPanel, editable, onChanged }) {
  const { t } = useTranslation('candidates');
  const { data: panels, loading } = useFetch('/panels');
  const { busy, error, run } = useAction(t, onChanged);

  if (!nomination) {
    return <p className="text-sm text-slate-700">{t('panelManager.needNomination')}</p>;
  }
  if (loading && !panels) return <Loading />;

  const locked = !editable || nomination.status === 'approved';
  const current = nomination.panel;
  const ownsCurrent = current && ownedPanel && ownedPanel.id === current.id;

  if (locked) {
    return (
      <p className="text-sm text-slate-700">
        {current ? t('panelManager.inPanel', { name: current.name }) : t('panelManager.independentNow')}
      </p>
    );
  }

  if (ownsCurrent) {
    return <OwnPanel t={t} panelId={current.id} onChanged={onChanged} selfCandidateId={nomination.id} />;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-800">
        {current ? t('panelManager.inPanel', { name: current.name }) : t('panelManager.independentNow')}
      </p>
      {current && (
        <Button variant="secondary" loading={busy} onClick={() => run(() => api.delete('/panels/membership/me'))}>
          {t('panelManager.leave')}
        </Button>
      )}

      <div>
        <h3 className="font-semibold text-slate-900">{t('panelManager.joinHeading')}</h3>
        {(() => {
          const joinable = (panels ?? []).filter((p) => p.id !== current?.id);
          if (joinable.length === 0) return <p className="mt-1 text-sm text-slate-600">{t('panelManager.noPanelsToJoin')}</p>;
          return (
            <ul className="mt-2 space-y-2">
              {joinable.map((p) => (
                <li key={p.id}>
                  <Card as="div" className="flex items-center justify-between gap-3 !p-3">
                    <span className="min-w-0 break-words font-medium text-slate-900">{p.name}</span>
                    <Button variant="secondary" disabled={busy} onClick={() => run(() => api.post(`/panels/${p.id}/join`))}>
                      {t('panelManager.join')}
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
          );
        })()}
      </div>

      {!current && !ownedPanel && <CreatePanelForm t={t} onChanged={onChanged} />}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
