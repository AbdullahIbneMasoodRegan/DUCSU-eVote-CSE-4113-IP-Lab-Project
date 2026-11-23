// M3 — election status banner: nomination / open / closed / published, with the relevant time (FR-03 data).
import { useTranslation } from 'react-i18next';
import { Alert } from '../../components/ui';
import { formatDhakaTime } from '../../i18n/index.js';

const TONE = { draft: 'info', nomination: 'info', open: 'success', closed: 'warning', published: 'success' };

export default function StatusBanner({ election }) {
  const { t } = useTranslation('public');
  if (!election) return <Alert tone="info">{t('banner.noElection')}</Alert>;
  const { status } = election;
  return (
    <Alert tone={TONE[status] ?? 'info'} title={`${election.title} — ${t(`banner.${status}`)}`}>
      {status === 'nomination' && (
        <>
          <p>{t('banner.starts', { time: formatDhakaTime(election.startsAt) })}</p>
          <p>{t('banner.nominationNote')}</p>
        </>
      )}
      {status === 'open' && <p>{t('banner.ends', { time: formatDhakaTime(election.endsAt) })}</p>}
      {status === 'closed' && <p>{t('banner.closedNote')}</p>}
    </Alert>
  );
}
