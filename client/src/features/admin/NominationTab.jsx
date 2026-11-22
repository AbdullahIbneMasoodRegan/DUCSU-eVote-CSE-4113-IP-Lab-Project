// M2 — Candidate Nomination Review Tab (FR-06).
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../app/api.js';

export default function NominationTab() {
  const { t } = useTranslation('admin');
  const [nominations, setNominations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [error, setError] = useState(null);

  // Reject modal state
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  async function loadNominations() {
    setLoading(true);
    setError(null);
    try {
      const url = statusFilter === 'all' ? '/admin/nominations' : `/admin/nominations?status=${statusFilter}`;
      const data = await api.get(url);
      setNominations(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadNominations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function handleApprove(id) {
    if (!confirm('Are you sure you want to approve this candidate nomination?')) return;
    setActionBusy(true);
    try {
      await api.patch(`/admin/nominations/${id}`, { status: 'approved' });
      loadNominations();
    } catch (err) {
      alert(`Approval failed: ${err.message}`);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleConfirmReject(e) {
    e.preventDefault();
    if (!rejectionReason.trim()) return;
    setActionBusy(true);
    try {
      await api.patch(`/admin/nominations/${rejectingId}`, {
        status: 'rejected',
        rejectionReason: rejectionReason.trim(),
      });
      setRejectingId(null);
      setRejectionReason('');
      loadNominations();
    } catch (err) {
      alert(`Rejection failed: ${err.message}`);
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{t('nominations.title')}</h2>
            <p className="mt-1 text-sm text-slate-600">Review, verify and approve or reject student candidates.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-600">{t('nominations.filterStatus')}:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700"
            >
              <option value="all">{t('nominations.all')}</option>
              <option value="pending">{t('nominations.pending')}</option>
              <option value="approved">{t('nominations.approved')}</option>
              <option value="rejected">{t('nominations.rejected')}</option>
            </select>
          </div>
        </div>

        {error && <div className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        {/* Nominations List */}
        <div className="mt-5 space-y-4">
          {nominations.map((nom) => (
            <div
              key={nom.id}
              className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-xs transition hover:border-slate-300 sm:flex-row sm:items-center gap-4"
            >
              <div className="flex items-start gap-4">
                <div className="h-14 w-14 shrink-0 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-500 overflow-hidden">
                  {nom.candidateName ? nom.candidateName[0] : 'C'}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">{nom.candidateName}</h3>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                        nom.status === 'approved'
                          ? 'bg-emerald-100 text-emerald-800'
                          : nom.status === 'rejected'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {t(`nominations.${nom.status}`)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-600 font-mono">
                    {nom.candidateRegNo} · {nom.candidateHall} · {nom.candidateDepartment}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-brand-800">
                    Contesting: {nom.positionNameEn} ({nom.positionNameBn})
                  </p>
                  <p className="text-xs text-slate-600">
                    Panel: <span className="font-medium text-slate-800">{nom.panelName || t('nominations.independent')}</span>
                  </p>
                  {nom.manifesto && (
                    <p className="mt-2 text-xs text-slate-700 bg-slate-50 p-2 rounded border border-slate-100">
                      <strong>Manifesto:</strong> {nom.manifesto}
                    </p>
                  )}
                  {nom.status === 'rejected' && nom.rejectionReason && (
                    <p className="mt-2 text-xs text-red-700 bg-red-50 p-2 rounded border border-red-200">
                      <strong>Rejection Reason:</strong> {nom.rejectionReason}
                    </p>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex shrink-0 items-center gap-2 sm:flex-col">
                {nom.status === 'pending' && (
                  <>
                    <button
                      onClick={() => handleApprove(nom.id)}
                      disabled={actionBusy}
                      className="rounded-md bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      ✓ {t('nominations.approve')}
                    </button>
                    <button
                      onClick={() => {
                        setRejectingId(nom.id);
                        setRejectionReason('');
                      }}
                      disabled={actionBusy}
                      className="rounded-md border border-red-300 bg-red-50 px-3.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      ✕ {t('nominations.reject')}
                    </button>
                  </>
                )}
                {nom.status !== 'pending' && (
                  <button
                    onClick={() => {
                      if (nom.status === 'approved') {
                        setRejectingId(nom.id);
                        setRejectionReason('');
                      } else {
                        handleApprove(nom.id);
                      }
                    }}
                    disabled={actionBusy}
                    className="text-xs text-slate-500 hover:text-slate-800 underline"
                  >
                    Change Decision
                  </button>
                )}
              </div>
            </div>
          ))}

          {nominations.length === 0 && !loading && (
            <div className="py-8 text-center text-sm text-slate-500">{t('nominations.noNominations')}</div>
          )}
        </div>
      </div>

      {/* Reject Modal */}
      {rejectingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Reject Candidate Nomination</h3>
            <p className="mt-1 text-xs text-slate-600">{t('nominations.rejectionPrompt')}</p>
            <form onSubmit={handleConfirmReject} className="mt-4">
              <textarea
                required
                rows={3}
                placeholder={t('nominations.reasonPlaceholder')}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                className="w-full rounded-md border border-slate-300 p-2.5 text-sm focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectingId(null)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionBusy || !rejectionReason.trim()}
                  className="rounded-md bg-red-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                >
                  {t('nominations.confirmReject')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
