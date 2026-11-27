// M1 — Observer dashboard (FR-15). Read-only: live turnout, system status and the
// audit log with its integrity check. Shows no personal voter data.
//
// Depends on other members' APIs; until they exist the matching card says so:
//   GET /api/turnout       (M3) — refreshed every 10 seconds
//   GET /api/audit/verify  (M2) — hash-chain integrity check
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../app/api.js';
import { formatDhakaTime } from '../../i18n/index.js';
import { Alert, Badge, Button, Card, Loading, PageLayout, useFetch } from '../../components/ui';

const REFRESH_MS = 10_000;
const PAGE = 20;

const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

/** Loads `path` now and every `ms`; a 404 means the API is not built yet. */
function usePolling(path, ms) {
  const [state, setState] = useState({ data: null, error: null, missing: false, loading: true });
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    async function load() {
      try {
        const data = await api.get(path, { signal: controller.signal });
        if (alive) setState({ data, error: null, missing: false, loading: false });
      } catch (error) {
        if (!alive || error.name === 'AbortError') return;
        setState((s) => ({ ...s, error, missing: error.status === 404, loading: false }));
      }
    }
    load();
    const id = setInterval(load, ms);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(id);
    };
  }, [path, ms]);
  return state;
}

function formatUptime(seconds, t) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return t('observer.uptimeValue', { h, m });
}

function TurnoutCard() {
  const { t } = useTranslation('system');
  const { data, error, missing, loading } = usePolling('/turnout', REFRESH_MS);
  const byHall = data?.byHall ?? data?.halls ?? [];
  const total = data?.total ?? data?.eligible ?? 0;
  const voted = data?.voted ?? 0;

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t('observer.turnout')}</h2>
      {loading && <Loading />}
      {missing && <p className="mt-2 text-slate-700">{t('observer.turnoutMissing')}</p>}
      {error && !missing && <Alert tone="error">{error.message}</Alert>}
      {data && (
        <>
          <p className="mt-2 text-3xl font-bold text-brand-800" data-testid="turnout-percent">
            {pct(voted, total)}%
          </p>
          <p className="text-slate-700">{t('observer.turnoutLine', { voted, total })}</p>
          <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
            <div className="h-full bg-brand-700" style={{ width: `${pct(voted, total)}%` }} />
          </div>
          {byHall.length > 0 && (
            <table className="mt-4 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-1.5 pr-3">{t('observer.hall')}</th>
                  <th className="py-1.5 pr-3 text-right">{t('observer.voted')}</th>
                  <th className="py-1.5 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {byHall.map((h) => (
                  <tr key={h.hall} className="border-b border-slate-100">
                    <td className="py-1.5 pr-3">{h.hall}</td>
                    <td className="py-1.5 pr-3 text-right">
                      {h.voted} / {h.total ?? h.eligible}
                    </td>
                    <td className="py-1.5 text-right">{pct(h.voted, h.total ?? h.eligible)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-slate-500">{t('observer.refreshes')}</p>
        </>
      )}
    </Card>
  );
}

function StatusCard() {
  const { t } = useTranslation('system');
  const health = usePolling('/health', REFRESH_MS);
  const election = useFetch('/admin/elections/current');
  const key = useFetch('/admin/crypto/public-key');
  const mail = useFetch('/admin/notifications');
  const el = election.data;

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t('observer.status')}</h2>
      <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="font-semibold">{t('observer.server')}</dt>
        <dd>
          {health.data ? (
            <>
              <Badge tone="success">{t('observer.online')}</Badge>{' '}
              {t('observer.uptime')} {formatUptime(health.data.uptimeSeconds ?? 0, t)}
            </>
          ) : health.error ? (
            <Badge tone="danger">{t('observer.offline')}</Badge>
          ) : (
            '…'
          )}
        </dd>

        <dt className="font-semibold">{t('observer.election')}</dt>
        <dd>
          {el ? (
            <>
              {el.title} <Badge tone="info">{t(`observer.statuses.${el.status}`, el.status)}</Badge>
              <br />
              {formatDhakaTime(el.startsAt)} – {formatDhakaTime(el.endsAt)}
            </>
          ) : election.loading ? (
            '…'
          ) : (
            t('observer.noElection')
          )}
        </dd>

        <dt className="font-semibold">{t('observer.encryption')}</dt>
        <dd>
          {key.data?.hasKey ? (
            <code className="break-all">{key.data.fingerprint}</code>
          ) : key.data ? (
            <Badge tone="warning">{t('observer.noKey')}</Badge>
          ) : (
            '…'
          )}
        </dd>

        <dt className="font-semibold">{t('observer.emails')}</dt>
        <dd>
          {mail.data
            ? mail.data.campaigns
                .map((c) => `${t(`notify.kinds.${c.kind}`)}: ${t(`notify.states.${c.state}`)}`)
                .join(' · ')
            : '…'}
        </dd>
      </dl>
    </Card>
  );
}

function AuditCard() {
  const { t } = useTranslation('system');
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState('');
  const query = `/audit?limit=${PAGE}&offset=${offset}${action ? `&action=${encodeURIComponent(action)}` : ''}`;
  const { data, error, loading } = useFetch(query);
  const [verify, setVerify] = useState(null);
  const [checking, setChecking] = useState(false);

  const runVerify = useCallback(async () => {
    setChecking(true);
    try {
      setVerify({ result: await api.get('/audit/verify') });
    } catch (err) {
      setVerify({ error: err });
    } finally {
      setChecking(false);
    }
  }, []);

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const ok = verify?.result && (verify.result.valid ?? verify.result.ok ?? verify.result.intact);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t('observer.audit')}</h2>
        <Button variant="secondary" onClick={runVerify} loading={checking}>
          {t('observer.verify')}
        </Button>
      </div>

      {verify?.error && (
        <Alert tone={verify.error.status === 404 ? 'info' : 'error'} className="mt-3">
          {verify.error.status === 404 ? t('observer.verifyMissing') : verify.error.message}
        </Alert>
      )}
      {verify?.result && (
        <Alert tone={ok ? 'success' : 'error'} className="mt-3">
          {ok
            ? t('observer.verifyOk', { n: verify.result.checked ?? verify.result.count ?? total })
            : t('observer.verifyBroken', {
                id: verify.result.firstBrokenId ?? verify.result.brokenAt ?? verify.result.firstInvalidId ?? '?',
              })}
        </Alert>
      )}

      <label className="mt-3 block text-sm">
        <span className="font-semibold">{t('observer.filter')}</span>{' '}
        <input
          className="ml-1 rounded-md border border-slate-400 px-2 py-1"
          value={action}
          placeholder="UPDATE_SETTING"
          onChange={(e) => {
            setOffset(0);
            setAction(e.target.value.trim().toUpperCase());
          }}
        />
      </label>

      {loading && <Loading />}
      {error && <Alert tone="error">{error.message}</Alert>}
      {data && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-1.5 pr-3">{t('observer.time')}</th>
                <th className="py-1.5 pr-3">{t('observer.actor')}</th>
                <th className="py-1.5 pr-3">{t('observer.action')}</th>
                <th className="py-1.5">{t('observer.target')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-slate-100 align-top">
                  <td className="whitespace-nowrap py-1.5 pr-3">{formatDhakaTime(l.createdAt)}</td>
                  <td className="py-1.5 pr-3">
                    {l.actorType}
                    {l.actorId ? ` #${l.actorId}` : ''}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{l.action}</td>
                  <td className="break-all py-1.5 font-mono text-xs">{l.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && <p className="py-3 text-slate-600">{t('observer.noEntries')}</p>}
          <div className="mt-3 flex items-center justify-between text-sm">
            <span>{t('observer.showing', { from: total ? offset + 1 : 0, to: offset + logs.length, total })}</span>
            <span className="flex gap-2">
              <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                {t('observer.newer')}
              </Button>
              <Button variant="secondary" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
                {t('observer.older')}
              </Button>
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function ObserverDashboard() {
  const { t } = useTranslation('system');
  return (
    <PageLayout title={t('observer.title')} subtitle={t('observer.subtitle')}>
      <div className="grid gap-4 lg:grid-cols-2">
        <TurnoutCard />
        <StatusCard />
      </div>
      <div className="mt-4">
        <AuditCard />
      </div>
    </PageLayout>
  );
}
