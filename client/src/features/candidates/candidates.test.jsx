// M3 — candidate list/profile, panels and the nomination page, with fetch mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../app/auth.jsx';
import { AppRoutes, routerFuture } from '../../app/App.jsx';

const json = (status, body) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const ok = (data) => () => json(200, { data });
const err = (status, code, message = '') => () => json(status, { error: { code, message } });

function mockServer(handlers) {
  const calls = [];
  globalThis.fetch = vi.fn((url, opts = {}) => {
    const key = `${opts.method ?? 'GET'} ${url}`;
    calls.push({ key, body: typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body });
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

const voter = { type: 'voter', id: 5, role: 'voter', name: 'Karim', hall: 'H', department: 'CSE' };
const POS = [
  { id: 1, nameEn: 'Vice-President (VP)', nameBn: 'সহ-সভাপতি (ভিপি)', displayOrder: 1, maxSelections: 1 },
  { id: 2, nameEn: 'General Secretary (GS)', nameBn: 'সাধারণ সম্পাদক (জিএস)', displayOrder: 2, maxSelections: 1 },
];
const candidate = (over = {}) => ({
  id: 7, name: 'Rahim Uddin', hall: 'Jagannath Hall', department: 'Physics', photoUrl: null,
  position: POS[0], panel: null, bio: 'Final-year student.', manifesto: 'Longer library hours.', ...over,
});
const groups = [
  { position: POS[0], candidates: [candidate({ panel: { id: 1, name: 'Ekota Panel' } })] },
  { position: POS[1], candidates: [] },
];

beforeEach(() => vi.restoreAllMocks());

describe('candidate list', () => {
  it('shows every post in order with candidates linking to their profile', async () => {
    mockServer({ 'GET /api/me': err(401, 'UNAUTHENTICATED'), 'GET /api/candidates': ok(groups) });
    renderAt('/candidates');

    const link = await screen.findByRole('link', { name: 'View profile of Rahim Uddin' });
    expect(link).toHaveAttribute('href', '/candidates/7');
    expect(within(link).getByText('Ekota Panel')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /1\. Vice-President/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /2\. General Secretary/ })).toBeInTheDocument();
  });

  it('filters by post', async () => {
    mockServer({ 'GET /api/me': err(401, 'UNAUTHENTICATED'), 'GET /api/candidates': ok(groups) });
    renderAt('/candidates');
    await screen.findByRole('link', { name: /Rahim/ });
    fireEvent.change(screen.getByLabelText('Filter by post'), { target: { value: '2' } });
    expect(screen.queryByRole('link', { name: /Rahim/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /2\. General Secretary/ })).toBeInTheDocument();
  });

  it('offers a retry when loading fails', async () => {
    mockServer({ 'GET /api/me': err(401, 'UNAUTHENTICATED'), 'GET /api/candidates': err(500, 'INTERNAL_ERROR') });
    renderAt('/candidates');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this page');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('candidate profile', () => {
  it('shows the profile and the panel link', async () => {
    mockServer({
      'GET /api/me': err(401, 'UNAUTHENTICATED'),
      'GET /api/candidates/7': ok(candidate({ panel: { id: 1, name: 'Ekota Panel' } })),
    });
    renderAt('/candidates/7');
    expect(await screen.findByRole('heading', { name: 'Rahim Uddin' })).toBeInTheDocument();
    expect(screen.getByText('Longer library hours.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ekota Panel' })).toHaveAttribute('href', '/panels/1');
  });

  it('says so when the candidate does not exist or is not approved', async () => {
    mockServer({ 'GET /api/me': err(401, 'UNAUTHENTICATED'), 'GET /api/candidates/9': err(404, 'CANDIDATE_NOT_FOUND') });
    renderAt('/candidates/9');
    expect(await screen.findByText('This candidate could not be found.')).toBeInTheDocument();
  });
});

describe('panels', () => {
  it('lists panels with member counts', async () => {
    mockServer({
      'GET /api/me': err(401, 'UNAUTHENTICATED'),
      'GET /api/panels': ok([{ id: 1, name: 'Ekota Panel', slogan: 'United', logoUrl: null, memberCount: 11 }]),
    });
    renderAt('/panels');
    expect(await screen.findByText('Ekota Panel')).toBeInTheDocument();
    expect(screen.getByText('11 approved candidates')).toBeInTheDocument();
  });
});

describe('nomination page', () => {
  const nominationData = (over = {}) => ({
    electionStatus: 'nomination', editable: true, nomination: null, ownedPanel: null, ...over,
  });
  const base = (mine) => ({
    'GET /api/me': ok({ user: voter }),
    'GET /api/nominations/me': ok(mine),
    'GET /api/candidates': ok(groups),
    'GET /api/panels': ok([]),
  });

  it('requires login', async () => {
    mockServer({ 'GET /api/me': err(401, 'UNAUTHENTICATED') });
    renderAt('/nomination');
    expect(await screen.findByLabelText('Registration number')).toBeInTheDocument();
  });

  it('validates, then submits a new nomination', async () => {
    let mine = nominationData();
    const calls = mockServer({
      ...base(mine),
      'GET /api/nominations/me': () => json(200, { data: mine }),
      'POST /api/nominations': () => {
        mine = nominationData({
          nomination: { ...candidate({ id: 3, name: 'Karim', status: 'pending', rejectionReason: null }), status: 'pending' },
        });
        return json(201, { data: mine.nomination });
      },
    });
    renderAt('/nomination');
    await screen.findByLabelText(/Post you are standing for/);

    fireEvent.click(screen.getByRole('button', { name: 'Submit nomination' }));
    expect((await screen.findAllByText('This field is required.')).length).toBe(3);
    expect(calls.some((c) => c.key === 'POST /api/nominations')).toBe(false);

    fireEvent.change(screen.getByLabelText(/Post you are standing for/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Short bio/), { target: { value: 'About me' } });
    fireEvent.change(screen.getByLabelText(/Your manifesto/), { target: { value: 'My plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit nomination' }));

    await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/nominations')?.body).toEqual({
      positionId: 2, bio: 'About me', manifesto: 'My plan',
    }));
    expect(await screen.findByText('Waiting for review')).toBeInTheDocument();
  });

  it('shows the rejection reason and lets the candidate edit', async () => {
    mockServer(base(nominationData({
      nomination: candidate({ id: 3, status: 'rejected', rejectionReason: 'Photo is unclear' }),
    })));
    renderAt('/nomination');
    expect(await screen.findByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Photo is unclear')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('locks the form once voting has started or the nomination is approved', async () => {
    mockServer(base(nominationData({
      editable: false, electionStatus: 'open',
      nomination: candidate({ id: 3, status: 'approved', rejectionReason: null }),
    })));
    renderAt('/nomination');
    expect(await screen.findByText('Approved')).toBeInTheDocument();
    expect(screen.getByText(/Voting has started/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw nomination' })).not.toBeInTheDocument();
  });

  it('shows a translated server error', async () => {
    mockServer({ ...base(nominationData()), 'POST /api/nominations': err(409, 'ALREADY_NOMINATED') });
    renderAt('/nomination');
    await screen.findByLabelText(/Post you are standing for/);
    fireEvent.change(screen.getByLabelText(/Post you are standing for/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Short bio/), { target: { value: 'a' } });
    fireEvent.change(screen.getByLabelText(/Your manifesto/), { target: { value: 'b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit nomination' }));
    expect(await screen.findByText('You have already submitted a nomination.')).toBeInTheDocument();
  });

  it('rejects photos that are too big or the wrong type before uploading', async () => {
    const calls = mockServer(base(nominationData({
      nomination: candidate({ id: 3, status: 'pending', rejectionReason: null }),
    })));
    renderAt('/nomination');
    const input = await screen.findByLabelText('Choose photo', { selector: 'input' });

    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText('That photo is larger than 2 MB.')).toBeInTheDocument();

    const gif = new File(['x'], 'a.gif', { type: 'image/gif' });
    fireEvent.change(input, { target: { files: [gif] } });
    expect(await screen.findByText('Please choose a JPEG or PNG image.')).toBeInTheDocument();
    expect(calls.some((c) => c.key.startsWith('PUT'))).toBe(false);
  });
});
