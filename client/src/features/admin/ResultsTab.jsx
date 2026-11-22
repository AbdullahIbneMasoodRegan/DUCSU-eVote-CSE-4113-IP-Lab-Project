// M2 — Results Calculation & Tally Tab (FR-14).
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../app/api.js';

export default function ResultsTab() {
  const { t } = useTranslation('admin');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function loadResults() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/results');
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadResults();
  }, []);

  async function handleCalculate() {
    setCalculating(true);
    setError(null);
    setNotice(null);
    try {
      await api.post('/results/calculate');
      setNotice('Results successfully calculated from ballots!');
      loadResults();
    } catch (err) {
      setError(`Calculation error: ${err.message}`);
    } finally {
      setCalculating(false);
    }
  }

  async function handlePublish() {
    if (!confirm('Are you sure you want to publish election results publicly to all voters?')) return;
    setPublishing(true);
    setError(null);
    try {
      await api.post('/results/publish');
      setNotice('Election results are now publicly published.');
      loadResults();
    } catch (err) {
      setError(`Publish error: ${err.message}`);
    } finally {
      setPublishing(false);
    }
  }

  const isPublished = Boolean(data?.election?.resultsPublishedAt);
  const consistency = data?.consistency;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{t('results.title')}</h2>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  isPublished ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {isPublished ? t('results.publishedBadge') : t('results.unpublishedBadge')}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleCalculate}
              disabled={calculating}
              className="rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {calculating ? t('results.calculating') : t('results.calculateBtn')}
            </button>
            {!isPublished && (
              <button
                onClick={handlePublish}
                disabled={publishing || !data?.positions?.length}
                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {publishing ? 'Publishing...' : t('results.publishBtn')}
              </button>
            )}
          </div>
        </div>

        {error && <div className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        {notice && <div className="mt-4 rounded bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

        {/* Cryptographic Consistency Card */}
        {consistency && (
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              {t('results.consistencyTitle')}
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="rounded bg-white p-3 border border-slate-200 text-center">
                <span className="text-xs text-slate-500">{t('results.totalBallots')}</span>
                <p className="mt-1 font-mono text-xl font-bold text-slate-900">{consistency.totalBallots}</p>
              </div>
              <div className="rounded bg-white p-3 border border-slate-200 text-center">
                <span className="text-xs text-slate-500">{t('results.totalReceipts')}</span>
                <p className="mt-1 font-mono text-xl font-bold text-slate-900">{consistency.totalReceipts}</p>
              </div>
              <div className="rounded bg-white p-3 border border-slate-200 text-center">
                <span className="text-xs text-slate-500">{t('results.votersMarked')}</span>
                <p className="mt-1 font-mono text-xl font-bold text-slate-900">{consistency.votersMarkedVoted}</p>
              </div>
              <div
                className={`rounded p-3 border flex flex-col items-center justify-center text-center ${
                  consistency.isConsistent
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-red-300 bg-red-50 text-red-800'
                }`}
              >
                <span className="text-xs font-semibold">Integrity Check</span>
                <p className="mt-1 text-xs font-bold">
                  {consistency.isConsistent ? `✓ ${t('results.statusVerified')}` : `✕ ${t('results.statusDiscrepancy')}`}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Results per position */}
        <div className="mt-6 space-y-6">
          {data?.positions?.map((pos) => (
            <div key={pos.positionId} className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="bg-slate-100 px-4 py-2.5 flex items-center justify-between border-b border-slate-200">
                <h4 className="text-sm font-bold text-slate-900">
                  {pos.displayOrder}. {pos.nameEn} ({pos.nameBn})
                </h4>
                <span className="text-xs text-slate-600">Seats: {pos.maxSelections}</span>
              </div>
              <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                  <tr>
                    <th className="px-4 py-2">{t('nominations.candidate')}</th>
                    <th className="px-4 py-2">{t('nominations.panel')}</th>
                    <th className="px-4 py-2 text-right">{t('results.votes')}</th>
                    <th className="px-4 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {pos.candidates.map((c) => (
                    <tr
                      key={c.candidateId}
                      className={c.isWinner ? 'bg-emerald-50/50' : c.tieFlag ? 'bg-amber-50/50' : ''}
                    >
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        {c.name}
                        {c.isWinner && <span className="ml-2 text-xs font-bold text-emerald-700">🏆 Winner</span>}
                        {c.tieFlag && <span className="ml-2 text-xs font-bold text-amber-700">⚖️ Tie</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{c.panelName}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-800">{c.votes}</td>
                      <td className="px-4 py-2.5 text-center text-xs">
                        {c.isWinner && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800">
                            {t('results.winner')}
                          </span>
                        )}
                        {c.tieFlag && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800">
                            {t('results.tie')}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {pos.candidates.length === 0 && (
                    <tr>
                      <td colSpan="4" className="px-4 py-4 text-center text-xs text-slate-500">
                        No votes recorded for this position.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}

          {(!data?.positions || data.positions.length === 0) && !loading && (
            <div className="py-8 text-center text-sm text-slate-500">{t('results.noResultsYet')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
