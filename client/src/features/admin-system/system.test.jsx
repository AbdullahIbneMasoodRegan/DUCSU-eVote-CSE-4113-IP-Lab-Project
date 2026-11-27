// M1 — EC settings page and ballot encryption key page.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../app/auth.jsx';
import { AppRoutes, routerFuture } from '../../app/App.jsx';
import { generateBallotKeyPair, fingerprintOf } from './keys.js';

const json = (status, body) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

const EC = { type: 'admin', id: 1, role: 'ec', name: 'EC' };

function mockServer(handlers) {
  const calls = [];
  globalThis.fetch = vi.fn((url, opts = {}) => {
    const key = `${opts.method ?? 'GET'} ${url}`;
    calls.push({ key, body: opts.body ? JSON.parse(opts.body) : undefined });
    if (key === 'GET /api/me') return json(200, { data: { user: EC } });
    const h = handlers[key];
    return h ? h(opts) : json(404, { error: { code: 'ROUTE_NOT_FOUND', message: 'nope' } });
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

const setting = (key, group, value, extra = {}) => ({
  key,
  group,
  unit: 'minutes',
  min: 1,
  max: 30,
  default: 5,
  value,
  isDefault: value === 5,
  updatedAt: null,
  ...extra,
});

describe('ballot key helpers', () => {
  it('generates a PEM key pair and a fingerprint in the server format', async () => {
    const pair = await generateBallotKeyPair();
    expect(pair.publicKey).toMatch(/^-----BEGIN PUBLIC KEY-----\n/);
    expect(pair.privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
    expect(pair.fingerprint).toMatch(/^([0-9a-f]{4}:){7}[0-9a-f]{4}$/);
    expect(await fingerprintOf(pair.publicKey)).toBe(pair.fingerprint);
  }, 30_000);
});

describe('Settings page', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows settings and saves only the changed value', async () => {
    const list = [setting('otp.ttlMinutes', 'otp', 5), setting('session.idleMinutes', 'session', 15, { default: 15 })];
    const calls = mockServer({
      'GET /api/admin/settings': () => json(200, { data: { settings: list, locked: false } }),
      'PUT /api/admin/settings': () =>
        json(200, { data: { settings: [{ ...list[0], value: 10, isDefault: false }, list[1]], locked: false } }),
    });
    renderAt('/admin/settings');

    const ttl = await screen.findByLabelText(/Code expires after/);
    expect(ttl).toHaveValue(5);
    fireEvent.change(ttl, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByText('Settings saved.');
    const put = calls.find((c) => c.key === 'PUT /api/admin/settings');
    expect(put.body).toEqual({ values: { 'otp.ttlMinutes': 10 } });
  });

  it('is read-only while voting is open', async () => {
    mockServer({
      'GET /api/admin/settings': () =>
        json(200, { data: { settings: [setting('otp.ttlMinutes', 'otp', 5)], locked: true } }),
    });
    renderAt('/admin/settings');
    expect(await screen.findByLabelText(/Code expires after/)).toBeDisabled();
    expect(screen.getByText(/Voting is open/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it('shows the server message next to an invalid field', async () => {
    mockServer({
      'GET /api/admin/settings': () =>
        json(200, { data: { settings: [setting('otp.ttlMinutes', 'otp', 5)], locked: false } }),
      'PUT /api/admin/settings': () =>
        json(400, {
          error: { code: 'INVALID_SETTING', message: 'otp.ttlMinutes must be 1 to 30.', details: { key: 'otp.ttlMinutes' } },
        }),
    });
    renderAt('/admin/settings');
    fireEvent.change(await screen.findByLabelText(/Code expires after/), { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findAllByText('otp.ttlMinutes must be 1 to 30.')).toHaveLength(2);
  });
});

describe('Encryption key page', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('generates, requires the download + confirmation, then uploads only the public key', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:key');
    URL.revokeObjectURL = vi.fn();
    const calls = mockServer({
      'GET /api/admin/crypto/public-key': () =>
        json(200, { data: { electionId: 1, hasKey: false, fingerprint: null, locked: false } }),
      'PUT /api/admin/crypto/public-key': () => json(200, { data: { electionId: 1, hasKey: true, fingerprint: 'x' } }),
    });
    renderAt('/admin/encryption');

    fireEvent.click(await screen.findByRole('button', { name: 'Generate key pair' }));
    const upload = await screen.findByRole('button', { name: 'Upload public key' }, { timeout: 30_000 });
    const confirm = screen.getByRole('checkbox');
    expect(upload).toBeDisabled();
    expect(confirm).toBeDisabled(); // must download first

    fireEvent.click(screen.getByRole('button', { name: 'Download private key file' }));
    expect(URL.createObjectURL).toHaveBeenCalled();
    fireEvent.click(confirm);
    fireEvent.click(upload);

    await screen.findByText(/The public key is saved/);
    const put = calls.find((c) => c.key === 'PUT /api/admin/crypto/public-key');
    expect(put.body.publicKey).toMatch(/BEGIN PUBLIC KEY/);
    expect(JSON.stringify(put.body)).not.toMatch(/PRIVATE KEY/);
  }, 40_000);

  it('shows the fingerprint and no generate button once voting has started', async () => {
    mockServer({
      'GET /api/admin/crypto/public-key': () =>
        json(200, { data: { electionId: 1, hasKey: true, fingerprint: 'abcd:ef01', locked: true } }),
    });
    renderAt('/admin/encryption');
    expect(await screen.findByTestId('fingerprint')).toHaveTextContent('abcd:ef01');
    expect(screen.getByText(/can no longer be changed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate key pair' })).toBeNull();
  });
});

describe('ballot key interop', () => {
  it('fingerprint ignores PEM line breaks', async () => {
    const pair = await generateBallotKeyPair();
    const oneLine = pair.publicKey.replace(/\n(?!-----END)/g, '');
    await waitFor(async () => expect(await fingerprintOf(oneLine)).toBe(pair.fingerprint));
  }, 30_000);
});
