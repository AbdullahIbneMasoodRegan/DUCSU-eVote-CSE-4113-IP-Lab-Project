// M4 — the receipt, shown once right after voting (FR-12): a random code with Copy and Download (.txt).
// The code arrives through in-memory router state, never the URL, and is not stored against the voter,
// so it cannot be shown again later.
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Button, ButtonLink, Card, PageLayout } from '../../components/ui';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function ReceiptPage() {
  const { t } = useTranslation('voting');
  const { state } = useLocation();
  const code = state?.receiptCode;
  const [copy, setCopy] = useState('idle'); // idle | copied | failed

  if (!code) {
    return (
      <PageLayout title={t('receipt.none.title')}>
        <Alert tone="info">{t('receipt.none.body')}</Alert>
        <p className="mt-4">
          <Link to="/voter" className="text-brand-700 underline">
            {t('receipt.home')}
          </Link>
        </p>
      </PageLayout>
    );
  }

  async function onCopy() {
    setCopy((await copyText(code)) ? 'copied' : 'failed');
  }

  function onDownload() {
    const text = [
      t('receipt.file.heading'),
      '',
      t('receipt.file.code', { code }),
      '',
      t('receipt.file.note'),
      '',
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ducsu-evote-receipt-${code}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <PageLayout title={t('receipt.title')}>
      <Card className="space-y-4">
        <p className="text-slate-800">{t('receipt.intro')}</p>
        <div>
          <p className="text-sm font-semibold text-slate-800">{t('receipt.codeLabel')}</p>
          <p
            data-testid="receipt-code"
            className="mt-1 select-all break-all rounded-md border border-slate-300 bg-slate-50 px-4 py-3 text-center font-mono text-2xl font-bold tracking-wider text-slate-900"
          >
            {code}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={onCopy}>{copy === 'copied' ? t('receipt.copied') : t('receipt.copy')}</Button>
          <Button variant="secondary" onClick={onDownload}>
            {t('receipt.download')}
          </Button>
        </div>
        {copy === 'failed' && <Alert tone="warning">{t('receipt.copyFailed')}</Alert>}
        <Alert tone="warning">{t('receipt.keep')}</Alert>
        <p className="text-sm text-slate-700">{t('receipt.later')}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <ButtonLink to="/receipts" variant="secondary">
            {t('receipt.publicList')}
          </ButtonLink>
          <ButtonLink to="/voter" variant="ghost">
            {t('receipt.home')}
          </ButtonLink>
        </div>
      </Card>
    </PageLayout>
  );
}
