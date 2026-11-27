// M1 — EC page: create the election's ballot encryption key (FR-11 extension).
// Steps: generate in this browser -> download the private key -> confirm -> upload the public key.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../app/api.js';
import { Alert, Button, Card, Loading, PageLayout, useFetch } from '../../components/ui';
import { generateBallotKeyPair, downloadText } from './keys.js';

export default function EncryptionKeyPage() {
  const { t } = useTranslation('system');
  const { data, error, loading, reload } = useFetch('/admin/crypto/public-key');
  const [pair, setPair] = useState(null);
  const [downloaded, setDownloaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [saved, setSaved] = useState(false);

  async function generate() {
    setActionError(null);
    setSaved(false);
    setBusy(true);
    try {
      setPair(await generateBallotKeyPair());
      setDownloaded(false);
      setConfirmed(false);
    } catch {
      setActionError(t('key.browserError'));
    } finally {
      setBusy(false);
    }
  }

  function download() {
    downloadText(`ducsu-evote-private-key-election-${data.electionId}.pem`, pair.privateKey);
    setDownloaded(true);
  }

  async function upload() {
    setActionError(null);
    setBusy(true);
    try {
      await api.put('/admin/crypto/public-key', { publicKey: pair.publicKey });
      setPair(null); // drop the private key from memory
      setSaved(true);
      reload();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageLayout
      title={t('key.title')}
      subtitle={t('key.subtitle')}
      back={{ to: '/admin', label: t('backToDashboard') }}
    >
      {loading && <Loading />}
      {error && <Alert tone="error">{error.message}</Alert>}

      {data && (
        <div className="space-y-4">
          <Card>
            <h2 className="text-lg font-semibold">{t('key.current')}</h2>
            {data.hasKey ? (
              <p className="mt-2">
                {t('key.fingerprint')}{' '}
                <code className="break-all rounded bg-slate-100 px-1.5 py-0.5" data-testid="fingerprint">
                  {data.fingerprint}
                </code>
              </p>
            ) : (
              <p className="mt-2 text-slate-700">{t('key.none')}</p>
            )}
          </Card>

          {saved && <Alert tone="success">{t('key.saved')}</Alert>}
          {actionError && <Alert tone="error">{actionError}</Alert>}

          {data.locked ? (
            <Alert tone="info">{t('key.locked')}</Alert>
          ) : (
            <Card>
              <h2 className="text-lg font-semibold">
                {data.hasKey ? t('key.replaceTitle') : t('key.createTitle')}
              </h2>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-800">
                <li>{t('key.step1')}</li>
                <li>{t('key.step2')}</li>
                <li>{t('key.step3')}</li>
              </ol>
              <Alert tone="warning" className="mt-3">
                {t('key.warning')}
              </Alert>

              {!pair ? (
                <Button className="mt-4" onClick={generate} loading={busy}>
                  {t('key.generate')}
                </Button>
              ) : (
                <div className="mt-4 space-y-3">
                  <p>
                    {t('key.newFingerprint')}{' '}
                    <code className="break-all rounded bg-slate-100 px-1.5 py-0.5">{pair.fingerprint}</code>
                  </p>
                  <Button variant="secondary" onClick={download}>
                    {t('key.download')}
                  </Button>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5"
                      checked={confirmed}
                      disabled={!downloaded}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    <span>{t('key.confirm')}</span>
                  </label>
                  <Button onClick={upload} disabled={!confirmed} loading={busy}>
                    {t('key.upload')}
                  </Button>
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </PageLayout>
  );
}
