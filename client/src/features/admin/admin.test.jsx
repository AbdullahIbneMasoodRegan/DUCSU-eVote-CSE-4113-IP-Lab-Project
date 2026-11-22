// M2 — Election Commission Dashboard Component Tests (FR-03, FR-04, FR-06, FR-14, FR-16).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../app/auth.jsx';
import { AppRoutes, routerFuture } from '../../app/App.jsx';

const json = (status, body) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );

function mockServer(handlers) {
  const calls = [];
  globalThis.fetch = vi.fn((url, opts = {}) => {
    const key = `${opts.method ?? 'GET'} ${url}`;
    calls.push({ key, body: opts.body ? JSON.parse(opts.body) : undefined });
    const h = handlers[key];
    return h ? h(opts) : json(200, { data: null });
  });
  return calls;
}

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]} future={routerFuture}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>
  );

describe('Admin Dashboard (M2)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders EC dashboard with tabs for authenticated EC user', async () => {
    const user = { type: 'admin', id: 1, role: 'ec', name: 'Commissioner Demo' };

    mockServer({
      'GET /api/me': () => json(200, { data: { user } }),
      'GET /api/admin/elections/current': () =>
        json(200, {
          data: {
            id: 1,
            title: 'DUCSU Central Election 2026',
            status: 'nomination',
            startsAt: '2026-11-23T04:00:00.000Z',
            endsAt: '2026-11-23T12:00:00.000Z',
          },
        }),
      'GET /api/admin/positions': () =>
        json(200, {
          data: [
            { id: 1, nameEn: 'Vice President', nameBn: 'সহ-সভাপতি', displayOrder: 1, maxSelections: 1 },
          ],
        }),
    });

    renderAt('/admin');

    // Check dashboard title
    expect(await screen.findByText('Election Commission Dashboard')).toBeInTheDocument();
    // Check tab navigation items
    expect(screen.getByText('Election & Positions')).toBeInTheDocument();
    expect(screen.getByText('Voter Management')).toBeInTheDocument();
    expect(screen.getByText('Nomination Review')).toBeInTheDocument();
    expect(screen.getByText('Results & Tally')).toBeInTheDocument();
    expect(screen.getByText('Audit Log')).toBeInTheDocument();

    // Check loaded election title in input
    await waitFor(() => {
      expect(screen.getByDisplayValue('DUCSU Central Election 2026')).toBeInTheDocument();
    });
  });

  it('switches to Voter Management tab and displays voters', async () => {
    const user = { type: 'admin', id: 1, role: 'ec', name: 'Commissioner' };

    mockServer({
      'GET /api/me': () => json(200, { data: { user } }),
      'GET /api/admin/elections/current': () => json(200, { data: null }),
      'GET /api/admin/positions': () => json(200, { data: [] }),
      'GET /api/admin/voters?limit=50&offset=0': () =>
        json(200, {
          data: {
            voters: [
              {
                id: 10,
                regNo: '2021-415-099',
                name: 'Anika Tabassum',
                email: 'anika@ducsu.test',
                hall: 'Ruqayyah Hall',
                department: 'CSE',
                eligible: true,
                hasVoted: false,
              },
            ],
            total: 1,
          },
        }),
    });

    renderAt('/admin');

    // Click on Voter Management tab
    const voterTabBtn = await screen.findByText('Voter Management');
    fireEvent.click(voterTabBtn);

    // Verify voter is rendered
    expect(await screen.findByText('Anika Tabassum')).toBeInTheDocument();
    expect(screen.getByText('2021-415-099')).toBeInTheDocument();
    expect(screen.getAllByText('Ruqayyah Hall').length).toBeGreaterThanOrEqual(1);
  });

  it('switches to Results tab and shows tally consistency verification', async () => {
    const user = { type: 'admin', id: 1, role: 'ec', name: 'Commissioner' };

    mockServer({
      'GET /api/me': () => json(200, { data: { user } }),
      'GET /api/admin/elections/current': () => json(200, { data: null }),
      'GET /api/admin/positions': () => json(200, { data: [] }),
      'GET /api/results': () =>
        json(200, {
          data: {
            election: { id: 1, title: 'DUCSU 2026', resultsPublishedAt: null },
            consistency: {
              totalBallots: 50,
              totalReceipts: 50,
              votersMarkedVoted: 50,
              isConsistent: true,
            },
            positions: [],
          },
        }),
    });

    renderAt('/admin');

    // Click on Results & Tally tab
    const resultsTabBtn = await screen.findByText('Results & Tally');
    fireEvent.click(resultsTabBtn);

    // Verify consistency check is displayed
    expect(await screen.findByText('Total Ballots Cast')).toBeInTheDocument();
    expect(screen.getAllByText('50').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/Consistency Verified/)).toBeInTheDocument();
  });
});
