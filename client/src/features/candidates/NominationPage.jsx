// M3 — /nomination : a voter nominates themselves, then sees their status and any rejection reason,
// edits the nomination, adds a photo and manages their panel (FR-05). Visible to voters and candidates.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Loading, Modal, PageLayout } from '../../components/ui';
import { useFetch } from '../../components/ui/useFetch.js';
import { api } from '../../app/api.js';
import { useAuth } from '../../app/auth.jsx';
import { errorMessage, positionName } from './format.js';
import NominationForm from './NominationForm.jsx';
import PanelManager from './PanelManager.jsx';
import PhotoUploader from './PhotoUploader.jsx';

const TONE = { pending: 'warning', approved: 'success', rejected: 'danger' };

export default function NominationPage() {
  const { t, i18n } = useTranslation('candidates');
  const { refresh } = useAuth();
  const mine = useFetch('/nominations/me');
  const posts = useFetch('/candidates');
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loading = (mine.loading && !mine.data) || (posts.loading && !posts.data);
  if (loading) return <Loading label={t('common:loading', { defaultValue: 'Loading…' })} />;
  if (mine.error || posts.error || !mine.data || !posts.data) {
    return (
      <Alert tone="error">
        <p>{t('loadError')}</p>
        <Button variant="secondary" className="mt-2" onClick={() => { mine.reload(); posts.reload(); }}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }

  const { nomination, editable, ownedPanel } = mine.data;
  const positions = posts.data.map((g) => g.position);
  const approved = nomination?.status === 'approved';
  const canEdit = editable && !approved;

  // The candidate role is computed on every request, so refresh the session user too.
  async function changed() {
    await Promise.all([mine.reload(), posts.reload()]);
    refresh().catch(() => {});
  }

  async function withdraw() {
    setBusy(true);
    setError('');
    try {
      await api.delete('/nominations/me');
      setConfirmWithdraw(false);
      await changed();
    } catch (err) {
      setConfirmWithdraw(false);
      setError(errorMessage(t, 'nomination.errors', err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageLayout title={t('nomination.title')} subtitle={t('nomination.intro')}>
      {!editable && (
        <Alert tone="warning" className="mb-4">
          {nomination ? t('nomination.locked') : t('nomination.closedNoNomination')}
        </Alert>
      )}
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}

      {nomination && (
        <Card className="mb-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-bold text-slate-900">{t('nomination.statusLabel')}</h2>
            <Badge tone={TONE[nomination.status]}>{t(`nomination.status.${nomination.status}`)}</Badge>
          </div>
          <p className="mt-2 text-sm text-slate-800">{t(`nomination.statusHelp.${nomination.status}`)}</p>
          <p className="mt-2 text-sm text-slate-700">
            {positionName(nomination.position, i18n.language)}
            {nomination.panel ? ` · ${nomination.panel.name}` : ''}
          </p>
          {nomination.status === 'rejected' && nomination.rejectionReason && (
            <Alert tone="error" title={t('nomination.rejectionReason')} className="mt-3">
              {nomination.rejectionReason}
            </Alert>
          )}
          <Link to={`/candidates/${nomination.id}`} className="mt-3 inline-block text-sm text-brand-700 underline">
            {t('nomination.viewPublic')}
          </Link>
        </Card>
      )}

      {(canEdit || nomination) && (
        <div className="space-y-5">
          {canEdit && (
            <Card>
              <h2 className="mb-3 text-lg font-bold text-slate-900">{t('nomination.form.heading')}</h2>
              <NominationForm
                key={nomination ? `n-${nomination.id}` : 'new'}
                positions={positions}
                nomination={nomination}
                onSaved={changed}
              />
            </Card>
          )}

          {nomination && (
            <>
              {canEdit && (
                <Card>
                  <PhotoUploader
                    path="/nominations/me/photo"
                    currentUrl={nomination.photoUrl}
                    name={nomination.name}
                    heading={t('nomination.photo.heading')}
                    errorScope="nomination.errors"
                    onUploaded={changed}
                  />
                </Card>
              )}
              <Card>
                <h2 className="mb-3 text-lg font-bold text-slate-900">{t('panelManager.heading')}</h2>
                <PanelManager nomination={nomination} ownedPanel={ownedPanel} editable={editable} onChanged={changed} />
              </Card>
              {canEdit && (
                <Button variant="danger" onClick={() => setConfirmWithdraw(true)}>
                  {t('nomination.withdraw.button')}
                </Button>
              )}
            </>
          )}
        </div>
      )}

      <Modal
        open={confirmWithdraw}
        onClose={() => setConfirmWithdraw(false)}
        title={t('nomination.withdraw.title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmWithdraw(false)}>{t('nomination.withdraw.cancel')}</Button>
            <Button variant="danger" loading={busy} onClick={withdraw}>{t('nomination.withdraw.confirm')}</Button>
          </>
        }
      >
        <p>{t('nomination.withdraw.body')}</p>
      </Modal>
    </PageLayout>
  );
}
