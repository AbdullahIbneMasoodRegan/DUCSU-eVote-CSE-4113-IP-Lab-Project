// M2 — Voter Management & CSV Import Tab (FR-04).
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../app/api.js';

export default function VoterTab() {
  const { t } = useTranslation('admin');
  const [voters, setVoters] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [search, setSearch] = useState('');
  const [hall, setHall] = useState('');
  const [page, setPage] = useState(0);
  const limit = 50;

  // Import Modal
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState(null);

  async function loadVoters() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.append('search', search.trim());
      if (hall) params.append('hall', hall);
      params.append('limit', String(limit));
      params.append('offset', String(page * limit));

      const res = await api.get(`/admin/voters?${params.toString()}`);
      setVoters(res.voters || []);
      setTotal(res.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadVoters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, hall, page]);

  async function handleToggleEligibility(voter) {
    try {
      const updated = await api.patch(`/admin/voters/${voter.id}/eligibility`, {
        eligible: !voter.eligible,
      });
      setVoters((prev) => prev.map((v) => (v.id === voter.id ? { ...v, eligible: updated.eligible } : v)));
    } catch (err) {
      alert(`Could not change eligibility: ${err.message}`);
    }
  }

  async function handleImportSubmit(e) {
    e.preventDefault();
    if (!csvText.trim()) return;
    setImporting(true);
    setImportReport(null);
    try {
      const res = await api.post('/admin/voters/import', { csv: csvText });
      setImportReport(res);
      setCsvText('');
      loadVoters();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Voter Roster Card */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{t('voters.title')}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {t('voters.totalCount')}: <strong className="font-semibold text-slate-900">{total}</strong>
            </p>
          </div>
          <button
            onClick={() => setShowImport(!showImport)}
            className="inline-flex items-center justify-center rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
          >
            📥 {t('voters.importButton')}
          </button>
        </div>

        {/* CSV Import Drawer / Box */}
        {showImport && (
          <div className="mt-5 rounded-lg border border-brand-200 bg-brand-50/50 p-4 sm:p-5">
            <h3 className="text-sm font-bold text-brand-900">{t('voters.modalTitle')}</h3>
            <p className="mt-1 text-xs text-slate-600">{t('voters.modalHelp')}</p>
            <form onSubmit={handleImportSubmit} className="mt-3">
              <textarea
                rows={4}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={t('voters.uploadPlaceholder')}
                className="w-full font-mono text-xs rounded-md border border-slate-300 p-2.5 focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700"
              />
              <div className="mt-2.5 flex items-center justify-between">
                <span className="text-xs text-slate-500">Auto-rejects invalid emails and duplicates.</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowImport(false)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {t('voters.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={importing || !csvText.trim()}
                    className="rounded-md bg-brand-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                  >
                    {importing ? 'Importing...' : t('voters.submitImport')}
                  </button>
                </div>
              </div>
            </form>

            {importReport && (
              <div className="mt-3 rounded-md bg-white p-3 border border-slate-200 text-xs">
                <p className="font-semibold text-emerald-800">
                  ✅ {t('voters.reportSuccess', { count: importReport.importedCount })}
                </p>
                {importReport.errorCount > 0 && (
                  <div className="mt-2">
                    <p className="font-semibold text-red-700">
                      ⚠️ {t('voters.reportErrors', { count: importReport.errorCount })}:
                    </p>
                    <ul className="mt-1 list-disc pl-5 text-red-600 space-y-0.5">
                      {importReport.errors.map((e, idx) => (
                        <li key={idx}>
                          Row {e.row} ({e.regNo || 'N/A'}): {e.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Filter controls */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <input
              type="text"
              placeholder={t('voters.searchPlaceholder')}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700"
            />
          </div>
          <div>
            <select
              value={hall}
              onChange={(e) => {
                setHall(e.target.value);
                setPage(0);
              }}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700"
            >
              <option value="">{t('voters.allHalls')}</option>
              <option value="Salimullah Muslim Hall">Salimullah Muslim Hall</option>
              <option value="Dr. Muhammad Shahidullah Hall">Dr. Muhammad Shahidullah Hall</option>
              <option value="Jagannath Hall">Jagannath Hall</option>
              <option value="Fazlul Huq Muslim Hall">Fazlul Huq Muslim Hall</option>
              <option value="Ruqayyah Hall">Ruqayyah Hall</option>
            </select>
          </div>
        </div>

        {error && <div className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        {/* Voters Table */}
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 font-semibold text-slate-700">
              <tr>
                <th className="px-3 py-2.5">{t('voters.regNo')}</th>
                <th className="px-3 py-2.5">{t('voters.name')}</th>
                <th className="px-3 py-2.5">{t('voters.email')}</th>
                <th className="px-3 py-2.5">{t('voters.hall')}</th>
                <th className="px-3 py-2.5">{t('voters.dept')}</th>
                <th className="px-3 py-2.5 text-center">{t('voters.eligibility')}</th>
                <th className="px-3 py-2.5 text-center">{t('voters.votedStatus')}</th>
                <th className="px-3 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {voters.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">{v.regNo}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{v.name}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{v.email}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{v.hall}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{v.department}</td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                        v.eligible ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {v.eligible ? t('voters.eligible') : t('voters.ineligible')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        v.hasVoted ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {v.hasVoted ? t('voters.voted') : t('voters.notVoted')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => handleToggleEligibility(v)}
                      className="text-xs font-medium text-brand-700 hover:text-brand-900 underline"
                    >
                      {t('voters.toggleEligibility')}
                    </button>
                  </td>
                </tr>
              ))}
              {voters.length === 0 && !loading && (
                <tr>
                  <td colSpan="8" className="px-3 py-6 text-center text-slate-500">
                    No voters found matching criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3 text-xs text-slate-600">
          <div>
            Showing {voters.length > 0 ? page * limit + 1 : 0} to {Math.min((page + 1) * limit, total)} of {total}
          </div>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
              className="rounded border border-slate-300 px-2.5 py-1 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={(page + 1) * limit >= total}
              onClick={() => setPage(page + 1)}
              className="rounded border border-slate-300 px-2.5 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
