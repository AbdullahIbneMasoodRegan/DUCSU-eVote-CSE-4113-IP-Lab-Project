// M2 — Audit Log Tab (FR-16).
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../app/api.js';
import { formatDhakaTime } from '../../i18n/index.js';

export default function AuditTab() {
  const { t } = useTranslation('admin');
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(0);
  const limit = 50;

  async function loadAudit() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (actionFilter) params.append('action', actionFilter);
      params.append('limit', String(limit));
      params.append('offset', String(page * limit));

      const res = await api.get(`/audit?${params.toString()}`);
      setLogs(res.logs || []);
      setTotal(res.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter, page]);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{t('audit.title')}</h2>
            <p className="mt-1 text-xs text-slate-600">{t('audit.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">Action:</span>
            <input
              type="text"
              placeholder="Filter by action..."
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(0);
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700"
            />
          </div>
        </div>

        {error && <div className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold text-slate-700">
              <tr>
                <th className="px-3 py-2.5">ID</th>
                <th className="px-3 py-2.5">{t('audit.actor')}</th>
                <th className="px-3 py-2.5">{t('audit.action')}</th>
                <th className="px-3 py-2.5">{t('audit.target')}</th>
                <th className="px-3 py-2.5">{t('audit.ip')}</th>
                <th className="px-3 py-2.5">{t('audit.timestamp')}</th>
                <th className="px-3 py-2.5">{t('audit.hash')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white font-mono">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-500">#{log.id}</td>
                  <td className="px-3 py-2 font-sans font-medium text-slate-800">
                    {log.actorType} (ID: {log.actorId ?? 'sys'})
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-slate-800 font-semibold text-[11px]">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{log.target || '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{log.ip || '—'}</td>
                  <td className="px-3 py-2 font-sans text-slate-600">
                    {formatDhakaTime(log.createdAt, { dateStyle: 'short', timeStyle: 'medium' })}
                  </td>
                  <td className="px-3 py-2 text-slate-400" title={`Prev: ${log.prevHash}\nHash: ${log.hash}`}>
                    {log.hash ? `${log.hash.slice(0, 10)}...` : '—'}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && !loading && (
                <tr>
                  <td colSpan="7" className="px-3 py-6 text-center text-slate-500 font-sans">
                    No audit records logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3 text-xs text-slate-600">
          <div>
            Showing {logs.length > 0 ? page * limit + 1 : 0} to {Math.min((page + 1) * limit, total)} of {total}
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
