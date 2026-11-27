// M1 — Observer dashboard (FR-15) and the EC election-emails page (FR-17).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../app/auth.jsx';
import { AppRoutes, routerFuture } from '../../app/App.jsx';

const json = (status, body) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const missing = () => json(404, { error: { code: 'ROUTE_NOT_FOUND', message: 'No such API route.' } });

function mockServer(user, handlers) {
  const calls = [];
  globalThis.fetch = vi.fn((url, opts = {}) => {
    const key = `${opts.method ?? 'GET'} ${url}`;
    calls.push(key);
    if (key === 'GET /api/me') return json(200, { data: { user } });
    const h = handlers[key.split('?')[0]]; // match the path, ignore the query string
    return h ? h() : missing();
  });
  return calls;
}

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]} future={routerFuture}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );

const OBSERVER = { type: 'admin', id: 2, role: 'observer', name: 'Observer' };
const EC = { type: 'admin', id: 1, role: 'ec', name: 'EC' };

const campaigns = {
  electionId: 1,
  transport: 'brevo',
  batchSize: 50,
  intervalSeconds: 60,
  enabled: true,
  recipients: { all: 200, notVoted: 120 },
  campaigns: [
    { kind: 'votingOpen', dueAt: '2026-11-25T07:44:00Z', state: 'finished', sent: 2, failed: 0, skipped: 198 },
    { kind: 'reminder', dueAt: '2026-11-27T04:00:00Z', state: 'waiting', sent: 0, failed: 0, skipped: 0 },
    { kind: 'resultsPublished', dueAt: null, state: 'waiting', sent: 0, failed: 0, skipped: 0 },
  ],
};

const common = {
  'GET /api/health': () => json(200, { data: { status: 'ok', uptimeSeconds: 7260 } }),
  'GET /api/admin/elections/current': () =>
    json(200, {
      data: { id: 1, title: 'DUCSU 2026', status: 'open', startsAt: '2026-11-25T07:44:00Z', endsAt: '2026-11-27T07:44:00Z' },
    }),
  'GET /api/admin/crypto/public-key': () => json(200, { data: { hasKey: true, fingerprint: 'ab12:cd34' } }),
  'GET /api/admin/notifications': () => json(200, { data: campaigns }),
  'GET /api/audit': () =>
    json(200, {
      data: {
        total: 1,
        logs: [{ id: 9, createdAt: '2026-11-24T10:00:00Z', actorType: 'admin', actorId: 1, action: 'UPDATE_SETTING', target: 'otp.ttlMinutes: 5 -> 10' }],
      },
    }),
};

describe('Observer dashboard', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows status and the audit log, and explains APIs that are not ready yet', async () => {
    mockServer(OBSERVER, common);
    renderAt('/observer');

    expect(await screen.findByText('Observer dashboard')).toBeInTheDocument();
    expect(await screen.findByText(/Live turnout will appear here/)).toBeInTheDocument();
    expect(await screen.findByText('ab12:cd34')).toBeInTheDocument();
    expect(await screen.findByText('2 h 1 min', { exact: false })).toBeInTheDocument();
    expect(await screen.findByText('UPDATE_SETTING')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Check integrity' }));
    expect(await screen.findByText(/integrity check will be available/)).toBeInTheDocument();
  });

  it('shows turnout with a hall breakdown and reports a broken audit chain', async () => {
    mockServer(OBSERVER, {
      ...common,
      'GET /api/turnout': () =>
        json(200, {
          data: {
            total: 200,
            voted: 50,
            byHall: [
              { hall: 'Jagannath Hall', total: 40, voted: 20 },
              { hall: 'Ruqayyah Hall', total: 160, voted: 30 },
            ],
          },
        }),
      'GET /api/audit/verify': () => json(200, { data: { valid: false, firstBrokenId: 4 } }),
    });
    renderAt('/observer');

    expect(await screen.findByTestId('turnout-percent')).toHaveTextContent('25%');
    expect(screen.getByText('Jagannath Hall')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Check integrity' }));
    expect(await screen.findByText(/first bad entry #4/)).toBeInTheDocument();
  });

  it('never asks for voter lists or personal data', async () => {
    const calls = mockServer(OBSERVER, common);
    renderAt('/observer');
    await screen.findByText('UPDATE_SETTING');
    expect(calls.some((c) => /voters|photos|ballot/.test(c))).toBe(false);
  });

  it('is only for observers', async () => {
    mockServer(EC, common);
    renderAt('/observer');
    expect((await screen.findAllByText(/Access denied/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText('Observer dashboard')).toBeNull();
  });
});

describe('EC election emails page', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows campaign progress and previews a template', async () => {
    mockServer(EC, {
      'GET /api/admin/notifications/preview': () =>
        json(200, { data: { subject: 'ভোটগ্রহণ শুরু হয়েছে | Voting is open', html: '<!doctype html><p>hi</p>' } }),
      'GET /api/admin/notifications': () => json(200, { data: campaigns }),
    });
    renderAt('/admin/notifications');

    expect(await screen.findByText(/200 eligible voters, 120 have not voted yet/)).toBeInTheDocument();
    expect(screen.getByText('2 sent, 0 failed, 198 test addresses skipped')).toBeInTheDocument();
    expect(screen.getAllByText('Finished').length).toBeGreaterThan(0);
    expect(await screen.findByText('ভোটগ্রহণ শুরু হয়েছে | Voting is open')).toBeInTheDocument();
    const frame = screen.getByTitle('Preview');
    expect(frame).toHaveAttribute('sandbox', '');
  });
});
