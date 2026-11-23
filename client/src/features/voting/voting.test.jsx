// M4 — ballot flow, review, photo capture, vote submission and receipts, with fetch and the camera mocked.
// This file reads sessionStorage/localStorage only to PROVE the ballot never writes to them (secrecy rule 6),
// which the project's no-restricted-properties lint rule would otherwise flag.
/* eslint-disable no-restricted-properties */
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
    calls.push({ key, body: opts.body });
    const h = handlers[key];
    return h ? h(opts) : json(404, { error: { code: 'ROUTE_NOT_FOUND', message: '' } });
  });
  return calls;
}

const renderAt = (entry) =>
  render(
    <MemoryRouter initialEntries={[entry]} future={routerFuture}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );

const voter = { type: 'voter', id: 5, role: 'voter', name: 'Karim', hall: 'H', department: 'CSE', eligible: true, hasVoted: false };
const cand = (id, name, panel = null) => ({ id, name, hall: 'Jagannath Hall', department: 'Physics', photoUrl: null, panel });
const ballot = {
  election: { id: 1, title: 'DUCSU Election 2026', startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-01-03T00:00:00Z' },
  positions: [
    {
      id: 1, nameEn: 'Vice-President (VP)', nameBn: 'সহ-সভাপতি (ভিপি)', displayOrder: 1, maxSelections: 1,
      candidates: [cand(11, 'Amina Rahman', { id: 1, name: 'Ekota Panel' }), cand(12, 'Bashir Ahmed')],
    },
    {
      id: 2, nameEn: 'Executive Member', nameBn: 'সদস্য', displayOrder: 2, maxSelections: 2,
      candidates: [cand(21, 'Alam Khan'), cand(22, 'Babu Mia'), cand(23, 'Chitra Das')],
    },
    { id: 3, nameEn: 'General Secretary (GS)', nameBn: 'জিএস', displayOrder: 3, maxSelections: 1, candidates: [] },
  ],
};

const baseHandlers = (extra = {}) => ({
  'GET /api/me': ok({ user: voter }),
  'GET /api/ballot': ok(ballot),
  ...extra,
});

function mockCamera() {
  const stop = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) },
  });
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() }));
  HTMLCanvasElement.prototype.toBlob = function toBlob(cb, type) {
    cb(new Blob(['jpeg-bytes'], { type }));
  };
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
  return { stop };
}

const click = (el) => fireEvent.click(el);
const btn = (name) => screen.getByRole('button', { name });

async function startVoting() {
  click(await screen.findByRole('button', { name: 'Start voting' }));
}

async function takePhoto() {
  click(await screen.findByRole('button', { name: 'Turn on camera' }));
  click(await screen.findByRole('button', { name: 'Take photo' }));
  await screen.findByText('Photo ready.');
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('ballot', () => {
  it('explains the secrecy and the photo, then shows one post at a time with progress', async () => {
    mockServer(baseHandlers());
    renderAt('/voter/vote');

    expect(await screen.findByText(/Your vote is secret/)).toBeInTheDocument();
    expect(screen.getByText(/A photo will be taken/)).toBeInTheDocument();
    expect(screen.getByText('There are 3 posts to vote on.')).toBeInTheDocument();

    await startVoting();
    expect(screen.getByText('Post 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vice-President (VP)' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByRole('radio', { name: /Amina Rahman/ })).toBeInTheDocument();
    expect(screen.getByText('Ekota Panel')).toBeInTheDocument();
    expect(screen.getByText('Independent')).toBeInTheDocument();

    click(screen.getByRole('radio', { name: /Amina Rahman/ }));
    click(btn('Next'));
    expect(screen.getByText('Post 2 of 3')).toBeInTheDocument();
  });

  it('never lets a voter choose more candidates than the post allows', async () => {
    mockServer(baseHandlers());
    renderAt('/voter/vote');
    await startVoting();
    click(btn('Skip this post'));

    expect(screen.getByText('Choose up to 2 candidates, or skip this post.')).toBeInTheDocument();
    click(screen.getByRole('checkbox', { name: /Alam Khan/ }));
    click(screen.getByRole('checkbox', { name: /Babu Mia/ }));
    expect(screen.getByText('Selected 2 of 2')).toBeInTheDocument();

    const third = screen.getByRole('checkbox', { name: /Chitra Das/ });
    expect(third).toBeDisabled();
    fireEvent.click(third); // even a forced click cannot add a third
    expect(screen.getByText('Selected 2 of 2')).toBeInTheDocument();
    expect(screen.getByText(/maximum for this post/)).toBeInTheDocument();

    click(screen.getByRole('checkbox', { name: /Alam Khan/ })); // unselect frees a slot
    expect(screen.getByRole('checkbox', { name: /Chitra Das/ })).toBeEnabled();
  });

  it('shows a post with no candidates and lets the voter move on', async () => {
    mockServer(baseHandlers());
    renderAt('/voter/vote');
    await startVoting();
    click(btn('Skip this post'));
    click(btn('Skip this post'));
    expect(screen.getByText('Post 3 of 3')).toBeInTheDocument();
    expect(screen.getByText('No candidates are standing for this post.')).toBeInTheDocument();
    click(btn('Review my choices'));
    expect(screen.getByRole('heading', { name: 'Review your choices' })).toBeInTheDocument();
  });

  it('opens a candidate profile in a modal and keeps the selections', async () => {
    mockServer(
      baseHandlers({
        'GET /api/candidates/11': ok({ ...cand(11, 'Amina Rahman'), position: ballot.positions[0], bio: 'Final-year student.', manifesto: 'Longer library hours.' }),
      }),
    );
    renderAt('/voter/vote');
    await startVoting();
    click(screen.getByRole('radio', { name: /Amina Rahman/ }));

    click(btn('View profile of Amina Rahman'));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Longer library hours.')).toBeInTheDocument();
    click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(screen.getByRole('radio', { name: /Amina Rahman/ })).toBeChecked();
  });

  it('keeps selections out of localStorage and sessionStorage', async () => {
    mockServer(baseHandlers());
    renderAt('/voter/vote');
    await startVoting();
    click(screen.getByRole('radio', { name: /Bashir Ahmed/ }));
    click(btn('Next'));
    click(screen.getByRole('checkbox', { name: /Alam Khan/ }));

    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(stored).not.toMatch(/Bashir|Alam|selections|candidate|"12"|"21"/i);
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it.each([
    ['VOTING_NOT_OPEN', 'Voting has not opened yet. Please come back when it starts.'],
    ['VOTING_CLOSED', 'Voting has closed.'],
    ['ALREADY_VOTED', /You have already voted/],
    ['NOT_ELIGIBLE', 'You are not eligible to vote in this election.'],
  ])('explains why the ballot is unavailable (%s)', async (code, text) => {
    mockServer(baseHandlers({ 'GET /api/ballot': err(code === 'NOT_ELIGIBLE' ? 403 : 409, code) }));
    renderAt('/voter/vote');
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start voting' })).not.toBeInTheDocument();
  });

  it('works in Bangla', async () => {
    const { setLanguage } = await import('../../i18n/index.js');
    setLanguage('bn');
    try {
      mockServer(baseHandlers());
      renderAt('/voter/vote');
      click(await screen.findByRole('button', { name: 'ভোট দেওয়া শুরু করুন' }));
      expect(screen.getByText('পদ 1 / 3')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'সহ-সভাপতি (ভিপি)' })).toBeInTheDocument();
    } finally {
      setLanguage('en');
    }
  });
});

describe('review, photo and submit', () => {
  async function reachReview() {
    await startVoting();
    click(screen.getByRole('radio', { name: /Amina Rahman/ }));
    click(btn('Next'));
    click(screen.getByRole('checkbox', { name: /Alam Khan/ }));
    click(screen.getByRole('checkbox', { name: /Babu Mia/ }));
    click(btn('Next'));
    click(btn('Review my choices')); // post 3 has no candidates
  }

  it('lists every post with the choice or "Left blank" and lets the voter change a choice', async () => {
    mockServer(baseHandlers());
    renderAt('/voter/vote');
    await reachReview();

    expect(screen.getByText('Amina Rahman')).toBeInTheDocument();
    expect(screen.getByText('Alam Khan')).toBeInTheDocument();
    expect(screen.getByText('Babu Mia')).toBeInTheDocument();
    expect(screen.getByText('Left blank')).toBeInTheDocument();
    expect(screen.getByText('1 post is left blank.')).toBeInTheDocument();

    click(screen.getByRole('button', { name: 'Change choice for Vice-President (VP)' }));
    expect(screen.getByText('Post 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Amina Rahman/ })).toBeChecked();
    click(screen.getByRole('radio', { name: /Bashir Ahmed/ }));
    click(btn('Back to review'));

    expect(screen.getByText('Bashir Ahmed')).toBeInTheDocument();
    expect(screen.queryByText('Amina Rahman')).not.toBeInTheDocument();
  });

  it('keeps the submit button disabled until a photo exists, then confirms and casts the vote', async () => {
    mockCamera();
    const calls = mockServer(
      baseHandlers({ 'POST /api/vote': () => json(201, { data: { receiptCode: 'DU-7KQ4-M9XP' } }) }),
    );
    renderAt('/voter/vote');
    await reachReview();
    click(btn('Continue to photo'));

    expect(btn('Cast my vote')).toBeDisabled();
    expect(screen.getByText('Take a photo to enable the submit button.')).toBeInTheDocument();
    await takePhoto();
    expect(screen.getByAltText('Your photo')).toBeInTheDocument();
    expect(btn('Cast my vote')).toBeEnabled();

    click(btn('Cast my vote'));
    expect(await screen.findByRole('dialog', { name: 'Cast your vote?' })).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/vote')).toBe(false); // nothing sent before confirming
    click(btn('Yes, cast my vote'));

    expect(await screen.findByTestId('receipt-code')).toHaveTextContent('DU-7KQ4-M9XP');

    const post = calls.find((c) => c.key === 'POST /api/vote');
    expect(post.body).toBeInstanceOf(FormData);
    expect(JSON.parse(post.body.get('choices'))).toEqual([
      { positionId: 1, candidateIds: [11] },
      { positionId: 2, candidateIds: [21, 22] },
    ]); // the blank post is simply absent
    const photo = post.body.get('photo');
    expect(photo.type).toBe('image/jpeg');
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it('lets the voter retake the photo and switches the camera off after capture', async () => {
    const { stop } = mockCamera();
    mockServer(baseHandlers());
    renderAt('/voter/vote');
    await reachReview();
    click(btn('Continue to photo'));
    await takePhoto();
    expect(stop).toHaveBeenCalled();

    click(btn('Retake photo'));
    expect(await screen.findByRole('button', { name: 'Take photo' })).toBeInTheDocument();
    expect(btn('Cast my vote')).toBeDisabled();
  });

  it.each([
    ['NotAllowedError', /Camera access was blocked/],
    ['NotFoundError', /No camera was found/],
  ])('explains a camera problem clearly (%s)', async (name, text) => {
    mockCamera();
    navigator.mediaDevices.getUserMedia.mockRejectedValue(Object.assign(new Error('x'), { name }));
    mockServer(baseHandlers());
    renderAt('/voter/vote');
    await reachReview();
    click(btn('Continue to photo'));
    click(btn('Turn on camera'));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(btn('Cast my vote')).toBeDisabled();
  });

  it('says so when the browser has no camera support', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    mockServer(baseHandlers());
    renderAt('/voter/vote');
    await reachReview();
    click(btn('Continue to photo'));
    click(btn('Turn on camera'));
    expect(await screen.findByText(/cannot use the camera/)).toBeInTheDocument();
  });

  it('shows a retry message when the server fails and keeps the voter on the page with every choice', async () => {
    mockCamera();
    const calls = mockServer(baseHandlers({ 'POST /api/vote': err(500, 'INTERNAL_ERROR') }));
    renderAt('/voter/vote');
    await reachReview();
    click(btn('Continue to photo'));
    await takePhoto();
    click(btn('Cast my vote'));
    click(await screen.findByRole('button', { name: 'Yes, cast my vote' }));

    expect(await screen.findByText(/Nothing was recorded, so please try again/)).toBeInTheDocument();
    expect(screen.queryByTestId('receipt-code')).not.toBeInTheDocument();
    expect(btn('Cast my vote')).toBeEnabled(); // photo and choices are still there

    // Try again: succeeds this time.
    globalThis.fetch.mockImplementation((url, opts = {}) => {
      const key = `${opts.method ?? 'GET'} ${url}`;
      if (key === 'POST /api/vote') return json(201, { data: { receiptCode: 'DU-AAAA-BBBB' } });
      return json(404, { error: { code: 'ROUTE_NOT_FOUND', message: '' } });
    });
    click(btn('Cast my vote'));
    click(await screen.findByRole('button', { name: 'Yes, cast my vote' }));
    expect(await screen.findByTestId('receipt-code')).toHaveTextContent('DU-AAAA-BBBB');
    expect(calls.filter((c) => c.key === 'POST /api/vote')).toHaveLength(1); // first attempt only; retry used the new mock
  });

  it('explains ALREADY_VOTED if the server rejects a second vote', async () => {
    mockCamera();
    mockServer(baseHandlers({ 'POST /api/vote': err(409, 'ALREADY_VOTED') }));
    renderAt('/voter/vote');
    await reachReview();
    click(btn('Continue to photo'));
    await takePhoto();
    click(btn('Cast my vote'));
    click(await screen.findByRole('button', { name: 'Yes, cast my vote' }));
    expect(await screen.findByText('You have already voted. A ballot can be cast only once.')).toBeInTheDocument();
  });
});

describe('receipt page (FR-12)', () => {
  const at = (state) => ({ pathname: '/voter/receipt', state });

  it('shows the code with Copy and Download buttons', async () => {
    mockServer(baseHandlers());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    URL.createObjectURL = vi.fn(() => 'blob:file');
    URL.revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderAt(at({ receiptCode: 'DU-7KQ4-M9XP' }));
    expect(await screen.findByTestId('receipt-code')).toHaveTextContent('DU-7KQ4-M9XP');

    click(btn('Copy code'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('DU-7KQ4-M9XP'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();

    click(btn('Download (.txt)'));
    expect(anchorClick).toHaveBeenCalled();
    const blob = URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toMatch(/text\/plain/);
    const text = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(blob);
    });
    expect(text).toContain('DU-7KQ4-M9XP');
    expect(screen.getByRole('link', { name: 'Public receipts list' })).toHaveAttribute('href', '/receipts');
  });

  it('never puts the code in the URL, and says the receipt is gone when opened directly', async () => {
    mockServer(baseHandlers());
    renderAt('/voter/receipt');
    expect(await screen.findByText('Receipt not available')).toBeInTheDocument();
    expect(screen.queryByTestId('receipt-code')).not.toBeInTheDocument();
  });
});

describe('public receipt list (FR-12)', () => {
  it('lists codes and searches as the voter types', async () => {
    const calls = mockServer({
      'GET /api/me': err(401, 'UNAUTHENTICATED'),
      'GET /api/receipts?q=': ok({ count: 2, codes: ['DU-2AAA-BBBB', 'DU-7KQ4-M9XP'] }),
      'GET /api/receipts?q=7KQ4': ok({ count: 1, codes: ['DU-7KQ4-M9XP'] }),
    });
    renderAt('/receipts');
    expect(await screen.findByText('DU-2AAA-BBBB')).toBeInTheDocument();
    expect(screen.getByText('2 receipts')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search for your receipt code'), { target: { value: '7KQ4' } });
    await waitFor(() => expect(screen.queryByText('DU-2AAA-BBBB')).not.toBeInTheDocument());
    expect(screen.getByText('DU-7KQ4-M9XP')).toBeInTheDocument();
    expect(screen.getByText('1 receipt')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'GET /api/receipts?q=7KQ4')).toBe(true);
  });

  it('says receipts appear after voting closes', async () => {
    mockServer({ 'GET /api/me': err(401, 'UNAUTHENTICATED'), 'GET /api/receipts?q=': err(409, 'VOTING_NOT_CLOSED') });
    renderAt('/receipts');
    expect(await screen.findByText('Receipts are published after voting closes.')).toBeInTheDocument();
  });

  it('reports a search with no match', async () => {
    mockServer({
      'GET /api/me': err(401, 'UNAUTHENTICATED'),
      'GET /api/receipts?q=': ok({ count: 0, codes: [] }),
    });
    renderAt('/receipts');
    expect(await screen.findByText('No receipt matches your search.')).toBeInTheDocument();
  });
});
