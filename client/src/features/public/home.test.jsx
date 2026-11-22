// M3 — public home page: status banner and role-aware links.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../app/auth.jsx';
import { AppRoutes, routerFuture } from '../../app/App.jsx';

const json = (status, body) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

function mockServer(handlers) {
  globalThis.fetch = vi.fn((url, opts = {}) => {
    const h = handlers[`${opts.method ?? 'GET'} ${url}`];
    return h ? h() : json(404, { error: { code: 'NO_ELECTION', message: '' } });
  });
}
const renderHome = () =>
  render(
    <MemoryRouter initialEntries={['/']} future={routerFuture}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );

const anon = () => json(401, { error: { code: 'UNAUTHENTICATED', message: '' } });
const election = (status) => () =>
  json(200, {
    data: {
      id: 1, title: 'DUCSU Election 2026-2027', status,
      startsAt: '2026-11-24T04:00:00.000Z', endsAt: '2026-11-26T12:00:00.000Z', serverTime: '2026-11-23T00:00:00.000Z',
    },
  });

beforeEach(() => vi.restoreAllMocks());

describe('home page', () => {
  it('shows the election, its status and the login link to visitors', async () => {
    mockServer({ 'GET /api/me': anon, 'GET /api/elections/current': election('nomination') });
    renderHome();
    expect(await screen.findByText(/DUCSU Election 2026-2027 — Nominations are open/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in to vote' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Meet the candidates' })).toHaveAttribute('href', '/candidates');
    expect(screen.queryByRole('link', { name: 'Stand as a candidate' })).not.toBeInTheDocument();
  });

  it('shows the closing time while voting is open', async () => {
    mockServer({ 'GET /api/me': anon, 'GET /api/elections/current': election('open') });
    renderHome();
    expect(await screen.findByText(/Voting is open/)).toBeInTheDocument();
    expect(screen.getByText(/Voting closes:/)).toBeInTheDocument();
  });

  it('copes with no election yet', async () => {
    mockServer({ 'GET /api/me': anon });
    renderHome();
    expect(await screen.findByText('No election has been set up yet.')).toBeInTheDocument();
  });

  it('offers a logged-in voter the nomination page, and a candidate their nomination', async () => {
    const user = (role) => () => json(200, { data: { user: { type: 'voter', id: 1, role, name: 'Karim' } } });
    mockServer({ 'GET /api/me': user('voter'), 'GET /api/elections/current': election('nomination') });
    const { unmount } = renderHome();
    expect(await screen.findByRole('link', { name: 'Stand as a candidate' })).toHaveAttribute('href', '/nomination');
    expect(screen.queryByRole('link', { name: 'Log in to vote' })).not.toBeInTheDocument();
    unmount();

    mockServer({ 'GET /api/me': user('candidate'), 'GET /api/elections/current': election('nomination') });
    renderHome();
    expect(await screen.findByRole('link', { name: 'My nomination' })).toHaveAttribute('href', '/nomination');
  });
});
