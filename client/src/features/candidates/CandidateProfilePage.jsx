// M3 — /candidates/:id (FR-07)
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, PageLayout } from '../../components/ui';
import CandidateProfile from './CandidateProfile.jsx';

export default function CandidateProfilePage() {
  const { t } = useTranslation('candidates');
  const { id } = useParams();
  return (
    <PageLayout title={t('list.title')} back={{ to: '/candidates', label: t('profile.back') }}>
      <Card>
        <CandidateProfile id={id} showLinks />
      </Card>
    </PageLayout>
  );
}
