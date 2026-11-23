// M4 — the voting page (FR-08, FR-09, FR-10, FR-19): notice -> one post per screen -> review -> photo -> confirm.
//
// SECRECY (work plan § 9, rule 6): the voter's selections live ONLY in this component's React state.
// They are never written to localStorage, sessionStorage, the URL or analytics, and they are dropped
// as soon as the vote is submitted. The state is lost on reload on purpose.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../app/api.js';
import { Alert, Button, Card, Loading, Modal, PageLayout } from '../../components/ui';
import { useFetch } from '../../components/ui/useFetch.js';
import CandidateProfile from '../candidates/CandidateProfile.jsx';
import BallotStep from './BallotStep.jsx';
import PhotoCapture from './PhotoCapture.jsx';
import ReviewStep from './ReviewStep.jsx';

export default function VotingFlow() {
  const { t } = useTranslation('voting');
  const navigate = useNavigate();
  const { data: ballot, error, loading } = useFetch('/ballot');

  const [phase, setPhase] = useState('intro'); // intro | steps | review | photo
  const [stepIndex, setStepIndex] = useState(0);
  const [returnToReview, setReturnToReview] = useState(false);
  const [selections, setSelections] = useState({}); // { [positionId]: candidateId[] } — React state only
  const [photo, setPhoto] = useState(null);
  const [profile, setProfile] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  if (loading) return <Loading label={t('loading')} />;

  if (error || !ballot) {
    const blocked = error?.code && t(`blocked.${error.code}`, { defaultValue: '' });
    return (
      <PageLayout title={t('intro.title')}>
        <Alert tone={blocked ? 'info' : 'error'}>{blocked || t('loadError')}</Alert>
        <p className="mt-4">
          <Link to="/voter" className="text-brand-700 underline">
            {t('backHome')}
          </Link>
        </p>
      </PageLayout>
    );
  }

  const { positions } = ballot;
  const post = positions[stepIndex];

  const setChoice = (positionId, ids) => setSelections((s) => ({ ...s, [positionId]: ids }));

  function goToStep(i) {
    setStepIndex(i);
    setPhase('steps');
  }

  function nextStep() {
    if (stepIndex < positions.length - 1) setStepIndex(stepIndex + 1);
    else setPhase('review');
  }

  function editFromReview(i) {
    setReturnToReview(true);
    goToStep(i);
  }

  function backToReview() {
    setReturnToReview(false);
    setPhase('review');
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const form = new FormData();
      form.append(
        'choices',
        JSON.stringify(
          positions
            .filter((p) => (selections[p.id] ?? []).length > 0)
            .map((p) => ({ positionId: p.id, candidateIds: selections[p.id] })),
        ),
      );
      form.append('photo', photo, 'verification.jpg');
      const { receiptCode } = await api.post('/vote', form);
      setSelections({}); // drop the choices immediately
      // The receipt is shown once, from the in-memory router state (never the URL).
      navigate('/voter/receipt', { replace: true, state: { receiptCode } });
    } catch (err) {
      // Any server error rolled everything back, so the voter can simply try again.
      setConfirmOpen(false);
      setSubmitError(t(`errors.${err?.code}`, { defaultValue: t('errors.generic') }));
      setSubmitting(false);
    }
  }

  return (
    <PageLayout title={t('intro.title')} subtitle={ballot.election.title}>
      {submitError && (
        <Alert tone="error" className="mb-4">
          {submitError}
        </Alert>
      )}

      {phase === 'intro' && (
        <Card className="space-y-4">
          <p className="font-semibold text-slate-900">{t('intro.posts', { count: positions.length })}</p>
          <p className="text-slate-700">{t('intro.how')}</p>
          <Alert tone="warning">{t('intro.once')}</Alert>
          <div>
            <h2 className="font-bold text-slate-900">{t('intro.secretTitle')}</h2>
            <p className="text-slate-700">{t('intro.secret')}</p>
          </div>
          <div>
            <h2 className="font-bold text-slate-900">{t('intro.photoTitle')}</h2>
            <p className="text-slate-700">{t('intro.photo')}</p>
          </div>
          <Button onClick={() => goToStep(0)} disabled={positions.length === 0}>
            {t('intro.start')}
          </Button>
        </Card>
      )}

      {phase === 'steps' && post && (
        <BallotStep
          key={post.id}
          post={post}
          index={stepIndex}
          total={positions.length}
          selected={selections[post.id] ?? []}
          onChange={(ids) => setChoice(post.id, ids)}
          onProfile={setProfile}
          onBack={() => setStepIndex(Math.max(0, stepIndex - 1))}
          onNext={nextStep}
          returnToReview={returnToReview}
          onBackToReview={backToReview}
        />
      )}

      {phase === 'review' && (
        <ReviewStep
          positions={positions}
          selections={selections}
          onEdit={editFromReview}
          onBack={() => goToStep(positions.length - 1)}
          onContinue={() => setPhase('photo')}
        />
      )}

      {phase === 'photo' && (
        <Card className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">{t('photo.title')}</h2>
          <p className="text-slate-700">{t('photo.explain')}</p>
          <PhotoCapture onChange={setPhoto} />
          {!photo && <p className="text-sm text-slate-700">{t('photo.required')}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <Button variant="secondary" onClick={() => setPhase('review')}>
              {t('photo.back')}
            </Button>
            <Button disabled={!photo || submitting} onClick={() => setConfirmOpen(true)}>
              {t('photo.submit')}
            </Button>
          </div>
        </Card>
      )}

      {/* The profile modal sits above the ballot; selections live in this component, so they are kept. */}
      <Modal open={Boolean(profile)} onClose={() => setProfile(null)} title={profile?.name ?? ''}>
        {profile && <CandidateProfile id={profile.id} />}
      </Modal>

      <Modal
        open={confirmOpen}
        onClose={() => !submitting && setConfirmOpen(false)}
        title={t('confirm.title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              {t('confirm.cancel')}
            </Button>
            <Button onClick={submit} loading={submitting}>
              {submitting ? t('confirm.submitting') : t('confirm.submit')}
            </Button>
          </>
        }
      >
        <p className="text-slate-800">{t('confirm.body')}</p>
      </Modal>
    </PageLayout>
  );
}
