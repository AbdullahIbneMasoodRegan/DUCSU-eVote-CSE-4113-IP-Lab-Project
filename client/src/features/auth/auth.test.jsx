// M1 — login pages and route guard, with fetch mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../app/auth.jsx';
import { AppRoutes, routerFuture } from '../../app/App.jsx';

const json = (status, body) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

function mockServer(handlers) {
  const calls = [];
  globalThis.fetch = vi.fn((url, opts = {}) => {
    const key = `${opts.method ?? 'GET'} ${url}`;
    calls.push({ key, body: opts.body ? JSON.parse(opts.body) : undefined });
    const h = handlers[key];
    return h ? h(opts) : json(404, { error: { code: 'ROUTE_NOT_FOUND', message: '' } });
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

const anonymous = () => json(401, { error: { code: 'UNAUTHENTICATED', message: '' } });

describe('voter OTP login', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('requests a code, verifies it and lands on the voter page', async () => {
    const user = { type: 'voter', id: 1, role: 'voter', name: 'Rahim' };
    const calls = mockServer({
      'GET /api/me': anonymous,
      'POST /api/auth/otp/request': () =>
        json(200, { data: { expiresInSeconds: 300, resendAfterSeconds: 60, message: '' } }),
      'POST /api/auth/otp/verify': () => json(200, { data: { user } }),
    });

    renderAt('/login');
    const regNo = await screen.findByLabelText('Registration number');
    fireEvent.change(regNo, { target: { value: '2021-415-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));

    const code = await screen.findByLabelText('6-digit code');
    expect(screen.getByText(/request a new code in 60 s/)).toBeInTheDocument();
    fireEvent.change(code, { target: { value: '12a3456' } });
    expect(code).toHaveValue('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Welcome, Rahim')).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/auth/otp/verify').body).toEqual({
      regNo: '2021-415-001',
      code: '123456',
    });
  });

  it('shows a clear message for a wrong code', async () => {
    mockServer({
      'GET /api/me': anonymous,
      'POST /api/auth/otp/request': () =>
        json(200, { data: { expiresInSeconds: 300, resendAfterSeconds: 60 } }),
      'POST /api/auth/otp/verify': () =>
        json(400, { error: { code: 'INVALID_CODE', message: 'x' } }),
    });
    renderAt('/login');
    fireEvent.change(await screen.findByLabelText('Registration number'), {
      target: { value: 'ABC-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    fireEvent.change(await screen.findByLabelText('6-digit code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect or has expired/);
  });
});

describe('RequireRole', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sends anonymous users to the right login page', async () => {
    mockServer({ 'GET /api/me': anonymous });
    renderAt('/admin');
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
  });

  it('blocks a voter from the EC dashboard', async () => {
    mockServer({
      'GET /api/me': () => json(200, { data: { user: { type: 'voter', id: 1, role: 'voter', name: 'R' } } }),
    });
    renderAt('/admin');
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });

  it('lets a candidate into voter pages', async () => {
    mockServer({
      'GET /api/me': () =>
        json(200, { data: { user: { type: 'voter', id: 2, role: 'candidate', name: 'Karim' } } }),
    });
    renderAt('/voter');
    expect(await screen.findByText('Welcome, Karim')).toBeInTheDocument();
  });

  it('logs out', async () => {
    const calls = mockServer({
      'GET /api/me': () => json(200, { data: { user: { type: 'admin', id: 1, role: 'ec', name: 'EC' } } }),
      'POST /api/auth/logout': () => json(200, { data: { loggedOut: true } }),
    });
    renderAt('/admin');
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(calls.map((c) => c.key)).toContain('POST /api/auth/logout'));
    expect(await screen.findByRole('link', { name: 'Voter login' })).toBeInTheDocument();
  });
});
