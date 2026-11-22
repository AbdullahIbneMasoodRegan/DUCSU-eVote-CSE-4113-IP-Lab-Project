// M2 — Election Setup & Positions Tab (FR-03, FR-04).
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../app/api.js';
import { formatDhakaTime } from '../../i18n/index.js';

export default function ElectionTab() {
  const { t } = useTranslation('admin');
  const [election, setElection] = useState(null);
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Form states
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');

  // Position add modal/inputs
  const [newPosEn, setNewPosEn] = useState('');
  const [newPosBn, setNewPosBn] = useState('');
  const [newPosOrder, setNewPosOrder] = useState('');
  const [newPosMax, setNewPosMax] = useState(1);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [elData, posData] = await Promise.all([
        api.get('/admin/elections/current'),
        api.get('/admin/positions'),
      ]);
      if (elData) {
        setElection(elData);
        setTitle(elData.title || '');
        setStartsAt(elData.startsAt ? elData.startsAt.slice(0, 16) : '');
        setEndsAt(elData.endsAt ? elData.endsAt.slice(0, 16) : '');
      }
      setPositions(posData || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const isLocked = election && new Date() >= new Date(election.startsAt);

  async function handleSaveElection(e) {
    e.preventDefault();
    if (isLocked) return;
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const payload = {
        title,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      };
      if (election?.id) payload.id = election.id;
      const res = await api.post('/admin/elections', payload);
      setElection(res);
      setSuccessMsg('Election settings successfully updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddPosition(e) {
    e.preventDefault();
    if (isLocked) return;
    setError(null);
    try {
      await api.post('/admin/positions', {
        nameEn: newPosEn,
        nameBn: newPosBn,
        displayOrder: Number(newPosOrder),
        maxSelections: Number(newPosMax),
      });
      setNewPosEn('');
      setNewPosBn('');
      setNewPosOrder('');
      setNewPosMax(1);
      loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-slate-500">Loading election setup...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Election Timing Card */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{t('election.title')}</h2>
            {election && (
              <p className="mt-1 text-sm text-slate-600">
                {t('election.status')}:{' '}
                <span className="inline-flex items-center rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-semibold text-brand-800 uppercase tracking-wide">
                  {election.status}
                </span>
              </p>
            )}
          </div>
          {isLocked && (
            <div className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
              ⚠️ {t('election.lockedNotice')}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>
        )}
        {successMsg && (
          <div className="mt-4 rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">
            {successMsg}
          </div>
        )}

        <form onSubmit={handleSaveElection} className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-slate-700">{t('election.electionTitle')}</label>
            <input
              type="text"
              disabled={isLocked}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700 disabled:bg-slate-100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">{t('election.startsAt')}</label>
            <input
              type="datetime-local"
              disabled={isLocked}
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700 disabled:bg-slate-100"
            />
            {election?.startsAt && (
              <span className="mt-1 block text-xs text-slate-500">
                Dhaka: {formatDhakaTime(election.startsAt)}
              </span>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">{t('election.endsAt')}</label>
            <input
              type="datetime-local"
              disabled={isLocked}
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700 disabled:bg-slate-100"
            />
            {election?.endsAt && (
              <span className="mt-1 block text-xs text-slate-500">
                Dhaka: {formatDhakaTime(election.endsAt)}
              </span>
            )}
          </div>

          {!isLocked && (
            <div className="sm:col-span-2 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 disabled:opacity-50"
              >
                {saving ? 'Saving...' : t('election.save')}
              </button>
            </div>
          )}
        </form>
      </div>

      {/* Positions Table Card */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <h2 className="text-lg font-bold text-slate-900">
            {t('election.positionsTitle')} ({positions.length})
          </h2>
        </div>

        {/* Add Position Form (if not locked) */}
        {!isLocked && (
          <form onSubmit={handleAddPosition} className="mt-4 rounded-md bg-slate-50 p-4 border border-slate-200">
            <h3 className="text-sm font-semibold text-slate-800">Add New Post</h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
              <input
                type="number"
                placeholder={t('election.order')}
                value={newPosOrder}
                onChange={(e) => setNewPosOrder(e.target.value)}
                required
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
              <input
                type="text"
                placeholder={t('election.nameEn')}
                value={newPosEn}
                onChange={(e) => setNewPosEn(e.target.value)}
                required
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
              <input
                type="text"
                placeholder={t('election.nameBn')}
                value={newPosBn}
                onChange={(e) => setNewPosBn(e.target.value)}
                required
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  placeholder={t('election.maxSelections')}
                  value={newPosMax}
                  onChange={(e) => setNewPosMax(e.target.value)}
                  required
                  className="w-20 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
                <button
                  type="submit"
                  className="flex-1 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800"
                >
                  + Add
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Positions Table */}
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 font-semibold text-slate-700">
              <tr>
                <th className="px-3 py-2.5 w-16">{t('election.order')}</th>
                <th className="px-3 py-2.5">{t('election.nameEn')}</th>
                <th className="px-3 py-2.5">{t('election.nameBn')}</th>
                <th className="px-3 py-2.5 w-24 text-center">{t('election.maxSelections')}</th>
                <th className="px-3 py-2.5 text-center">{t('election.candidatesCount')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {positions.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-medium text-slate-900">{p.displayOrder}</td>
                  <td className="px-3 py-2.5 text-slate-800 font-medium">{p.nameEn}</td>
                  <td className="px-3 py-2.5 text-slate-600">{p.nameBn}</td>
                  <td className="px-3 py-2.5 text-center font-mono">{p.maxSelections}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                      <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        {p.approvedCandidatesCount ?? 0} approved
                      </span>
                      {p.pendingCandidatesCount > 0 && (
                        <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                          {p.pendingCandidatesCount} pending
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
              {positions.length === 0 && (
                <tr>
                  <td colSpan="5" className="px-3 py-6 text-center text-slate-500">
                    No positions defined yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
