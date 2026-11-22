// M2 — Election Commission Dashboard Shell (FR-03, FR-04, FR-06, FR-14, FR-16).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ElectionTab from './ElectionTab.jsx';
import VoterTab from './VoterTab.jsx';
import NominationTab from './NominationTab.jsx';
import ResultsTab from './ResultsTab.jsx';
import AuditTab from './AuditTab.jsx';

const TABS = [
  { id: 'election', icon: '🗳️' },
  { id: 'voters', icon: '👥' },
  { id: 'nominations', icon: '📋' },
  { id: 'results', icon: '📊' },
  { id: 'audit', icon: '🔒' },
];

export default function AdminDashboard() {
  const { t } = useTranslation('admin');
  const [activeTab, setActiveTab] = useState('election');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header Banner */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h1 className="text-xl font-bold text-brand-800 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-xs text-slate-600 sm:text-sm">{t('subtitle')}</p>

        {/* Tab Navigation */}
        <div className="mt-6 flex flex-wrap gap-2 border-b border-slate-200 pb-2">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-semibold sm:text-sm transition ${
                  isActive
                    ? 'bg-brand-700 text-white shadow-xs'
                    : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span>{tab.icon}</span>
                <span>{t(`tabs.${tab.id}`)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Tab Content */}
      <main>
        {activeTab === 'election' && <ElectionTab />}
        {activeTab === 'voters' && <VoterTab />}
        {activeTab === 'nominations' && <NominationTab />}
        {activeTab === 'results' && <ResultsTab />}
        {activeTab === 'audit' && <AuditTab />}
      </main>
    </div>
  );
}
