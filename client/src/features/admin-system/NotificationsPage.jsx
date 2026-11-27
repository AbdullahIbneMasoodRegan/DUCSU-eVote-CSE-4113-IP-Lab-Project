// M1 — EC page for election emails (FR-17): campaign progress and a preview of every template.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDhakaTime } from '../../i18n/index.js';
import { Alert, Badge, Card, FormField, Loading, PageLayout, useFetch } from '../../components/ui';

const TEMPLATES = ['votingOpen', 'reminder', 'resultsPublished', 'otp'];
const STATE_TONE = { waiting: 'neutral', sending: 'warning', finished: 'success' };

export default function NotificationsPage() {
  const { t } = useTranslation('system');
  const { data, error, loading } = useFetch('/admin/notifications');
  const [template, setTemplate] = useState('votingOpen');
  const [lang, setLang] = useState('both');
  const preview = useFetch(`/admin/notifications/preview?template=${template}&lang=${lang}`);

  return (
    <PageLayout
      title={t('notify.title')}
      subtitle={t('notify.subtitle')}
      back={{ to: '/admin', label: t('backToDashboard') }}
    >
      {loading && <Loading />}
      {error && <Alert tone={error.code === 'NO_ELECTION' ? 'info' : 'error'}>{error.message}</Alert>}

      {data && (
        <Card className="mb-4">
          <p className="text-slate-700">
            {t('notify.summary', {
              all: data.recipients.all,
              notVoted: data.recipients.notVoted,
              batch: data.batchSize,
              seconds: data.intervalSeconds,
            })}
          </p>
          {!data.enabled && (
            <Alert tone="warning" className="mt-3">
              {t('notify.disabled')}
            </Alert>
          )}
          {data.transport === 'console' && (
            <Alert tone="info" className="mt-3">
              {t('notify.consoleTransport')}
            </Alert>
          )}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-2 pr-3">{t('notify.email')}</th>
                  <th className="py-2 pr-3">{t('notify.when')}</th>
                  <th className="py-2 pr-3">{t('notify.state')}</th>
                  <th className="py-2 pr-3">{t('notify.counts')}</th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((c) => (
                  <tr key={c.kind} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-medium">{t(`notify.kinds.${c.kind}`)}</td>
                    <td className="py-2 pr-3">
                      {c.dueAt ? formatDhakaTime(c.dueAt) : t('notify.afterPublish')}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={STATE_TONE[c.state]}>{t(`notify.states.${c.state}`)}</Badge>
                    </td>
                    <td className="py-2 pr-3">
                      {t('notify.countLine', { sent: c.sent, failed: c.failed, skipped: c.skipped })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-lg font-semibold">{t('notify.preview')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField as="select" label={t('notify.template')} value={template} onChange={(e) => setTemplate(e.target.value)}>
            {TEMPLATES.map((k) => (
              <option key={k} value={k}>
                {t(`notify.kinds.${k}`)}
              </option>
            ))}
          </FormField>
          <FormField as="select" label={t('notify.language')} value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="both">{t('notify.langs.both')}</option>
            <option value="bn">বাংলা</option>
            <option value="en">English</option>
          </FormField>
        </div>
        {preview.error && <Alert tone="error">{preview.error.message}</Alert>}
        {preview.data && (
          <div className="mt-4">
            <p className="text-sm text-slate-700">
              <span className="font-semibold">{t('notify.subject')}</span> {preview.data.subject}
            </p>
            {/* sandbox: the preview can run no scripts and open nothing */}
            <iframe
              title={t('notify.preview')}
              sandbox=""
              srcDoc={preview.data.html}
              className="mt-2 h-[32rem] w-full rounded-md border border-slate-200"
            />
          </div>
        )}
      </Card>
    </PageLayout>
  );
}
