// M3 — nominations, candidates and panels (FR-05, FR-06 read side, FR-07).
import { describe, it, expect, beforeEach } from 'vitest';
import sharp from 'sharp';
import { query } from '../../src/core/db.js';
import { agent, api, resetDb, createVoter, createAdmin, loginVoter } from '../helpers.js';

async function setupElection({ started = false } = {}) {
  const startsAt = started ? "now() - interval '1 hour'" : "now() + interval '1 day'";
  const { rows: e } = await query(
    `INSERT INTO elections (title, starts_at, ends_at)
     VALUES ('Test Election', ${startsAt}, now() + interval '3 days') RETURNING id`,
  );
  const positions = [];
  for (const [i, name] of ['VP', 'GS', 'AGS'].entries()) {
    const { rows: p } = await query(
      `INSERT INTO positions (election_id, name_en, name_bn, display_order)
       VALUES ($1, $2, $2, $3) RETURNING id`,
      [e[0].id, name, i + 1],
    );
    positions.push(p[0].id);
  }
  return { electionId: e[0].id, positions };
}

async function voterAgent(overrides) {
  const voter = await createVoter(overrides);
  const ag = agent();
  await loginVoter(ag, voter).then((r) => expect(r.status).toBe(200));
  return { voter, ag };
}

const nomination = (positionId, extra = {}) => ({
  positionId,
  bio: 'A short bio.',
  manifesto: 'What I will do.',
  ...extra,
});

const png = (w = 40, h = 40) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#2b7' } }).png().toBuffer();

async function approve(candidateId) {
  await query(`UPDATE candidates SET status = 'approved' WHERE id = $1`, [candidateId]);
}

describe('Nominations (FR-05)', () => {
  beforeEach(resetDb);

  it('lets a voter nominate and then shows the nomination and pending status', async () => {
    const { positions } = await setupElection();
    const { ag } = await voterAgent();

    const res = await ag.post('/api/nominations').send(nomination(positions[0])).expect(201);
    expect(res.body.data).toMatchObject({ status: 'pending', bio: 'A short bio.', panel: null });
    expect(res.body.data).not.toHaveProperty('regNo');

    const me = await ag.get('/api/nominations/me').expect(200);
    expect(me.body.data.nomination.status).toBe('pending');
    expect(me.body.data.editable).toBe(true);
  });

  it('returns nomination: null before anything is submitted', async () => {
    await setupElection();
    const { ag } = await voterAgent();
    const me = await ag.get('/api/nominations/me').expect(200);
    expect(me.body.data.nomination).toBeNull();
  });

  it('allows only one nomination per student', async () => {
    const { positions } = await setupElection();
    const { ag } = await voterAgent();
    await ag.post('/api/nominations').send(nomination(positions[0])).expect(201);
    const again = await ag.post('/api/nominations').send(nomination(positions[1])).expect(409);
    expect(again.body.error.code).toBe('ALREADY_NOMINATED');
  });

  it('rejects logged-out users, bad input and ineligible voters', async () => {
    const { positions } = await setupElection();
    await api().post('/api/nominations').send(nomination(positions[0])).expect(401);

    const { ag } = await voterAgent();
    const bad = await ag.post('/api/nominations').send({ positionId: positions[0] }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');

    const { voter, ag: ag2 } = await voterAgent();
    await query('UPDATE voters SET eligible = false WHERE id = $1', [voter.id]);
    // an ineligible voter's session still exists; the nomination itself must be refused
    const res = await ag2.post('/api/nominations').send(nomination(positions[0])).expect(403);
    expect(res.body.error.code).toBe('NOT_ELIGIBLE');
  });

  it('rejects a position from another election', async () => {
    await setupElection();
    const { ag } = await voterAgent();
    const res = await ag.post('/api/nominations').send(nomination(999999)).expect(404);
    expect(res.body.error.code).toBe('POSITION_NOT_FOUND');
  });

  it('is locked once voting has started (edit lock, FR-04)', async () => {
    const { positions } = await setupElection({ started: true });
    const { ag } = await voterAgent();
    const res = await ag.post('/api/nominations').send(nomination(positions[0])).expect(409);
    expect(res.body.error.code).toBe('ELECTION_LOCKED');
  });

  it('edits a nomination, and a rejected one goes back to pending', async () => {
    const { positions } = await setupElection();
    const { ag } = await voterAgent();
    const created = await ag.post('/api/nominations').send(nomination(positions[0])).expect(201);
    await query(
      `UPDATE candidates SET status = 'rejected', rejection_reason = 'Missing details' WHERE id = $1`,
      [created.body.data.id],
    );

    const me = await ag.get('/api/nominations/me').expect(200);
    expect(me.body.data.nomination).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Missing details',
    });

    const edited = await ag.patch('/api/nominations/me').send({ bio: 'Better bio.' }).expect(200);
    expect(edited.body.data).toMatchObject({
      status: 'pending',
      rejectionReason: null,
      bio: 'Better bio.',
    });
  });

  it('does not allow changing an approved nomination', async () => {
    const { positions } = await setupElection();
    const { ag } = await voterAgent();
    const created = await ag.post('/api/nominations').send(nomination(positions[0])).expect(201);
    await approve(created.body.data.id);
    const res = await ag.patch('/api/nominations/me').send({ bio: 'Sneaky edit' }).expect(409);
    expect(res.body.error.code).toBe('NOMINATION_APPROVED');
    await ag.delete('/api/nominations/me').expect(409);
  });

  it('withdraws a nomination', async () => {
    const { positions } = await setupElection();
    const { ag } = await voterAgent();
    await ag.post('/api/nominations').send(nomination(positions[0])).expect(201);
    await ag.delete('/api/nominations/me').expect(200);
    const me = await ag.get('/api/nominations/me').expect(200);
    expect(me.body.data.nomination).toBeNull();
  });
});

describe('Candidate photo upload (FR-05)', () => {
  beforeEach(resetDb);

  async function nominated() {
    const { positions } = await setupElection();
    const ctx = await voterAgent();
    const res = await ctx.ag.post('/api/nominations').send(nomination(positions[0])).expect(201);
    return { ...ctx, candidateId: res.body.data.id };
  }

  it('re-encodes the image and strips metadata', async () => {
    const { ag, candidateId } = await nominated();
    const withExif = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: '#c33' },
    })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'SECRET-OWNER' } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const res = await ag
      .put('/api/nominations/me/photo')
      .set('Content-Type', 'image/jpeg')
      .send(withExif)
      .expect(200);
    expect(res.body.data.photoUrl).toBe(`/api/candidates/${candidateId}/photo`);

    // The owner can see it while pending; it is resized and has no EXIF.
    const photo = await ag.get(`/api/candidates/${candidateId}/photo`).expect(200);
    expect(photo.headers['content-type']).toBe('image/jpeg');
    const meta = await sharp(photo.body).metadata();
    expect(meta.exif).toBeUndefined();
    expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(800);
    expect(photo.headers['cache-control']).toContain('no-store');
  });

  it('rejects files that are not real JPEG/PNG images', async () => {
    const { ag } = await nominated();
    const fake = await ag
      .put('/api/nominations/me/photo')
      .set('Content-Type', 'image/png')
      .send(Buffer.from('<script>alert(1)</script>'))
      .expect(400);
    expect(fake.body.error.code).toBe('INVALID_IMAGE');

    const gif = await sharp({ create: { width: 5, height: 5, channels: 3, background: '#000' } })
      .gif()
      .toBuffer();
    await ag.put('/api/nominations/me/photo').set('Content-Type', 'image/png').send(gif).expect(400);
    await ag.put('/api/nominations/me/photo').set('Content-Type', 'text/plain').send('hi').expect(400);
  });

  it('rejects uploads over 2 MB', async () => {
    const { ag } = await nominated();
    const big = Buffer.alloc(2 * 1024 * 1024 + 10, 1);
    const res = await ag
      .put('/api/nominations/me/photo')
      .set('Content-Type', 'image/jpeg')
      .send(big)
      .expect(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('replaces the previous photo instead of piling up files', async () => {
    const { ag } = await nominated();
    for (let i = 0; i < 2; i += 1) {
      await ag
        .put('/api/nominations/me/photo')
        .set('Content-Type', 'image/png')
        .send(await png())
        .expect(200);
    }
    const { rows } = await query('SELECT count(*)::int AS n FROM files');
    expect(rows[0].n).toBe(1);
  });

  it('requires a nomination and a login', async () => {
    await setupElection();
    await api().put('/api/nominations/me/photo').set('Content-Type', 'image/png').send(await png()).expect(401);
    const { ag } = await voterAgent();
    await ag
      .put('/api/nominations/me/photo')
      .set('Content-Type', 'image/png')
      .send(await png())
      .expect(404);
  });
});

describe('Public candidate pages (FR-06, FR-07)', () => {
  beforeEach(resetDb);

  it('lists only approved candidates, grouped by position in display order', async () => {
    const { positions } = await setupElection();
    const a = await voterAgent({ name: 'Approved Person' });
    const b = await voterAgent({ name: 'Pending Person' });
    const ca = await a.ag.post('/api/nominations').send(nomination(positions[1])).expect(201);
    await b.ag.post('/api/nominations').send(nomination(positions[1])).expect(201);
    await approve(ca.body.data.id);

    const res = await api().get('/api/candidates').expect(200); // no login needed
    const groups = res.body.data;
    expect(groups.map((g) => g.position.nameEn)).toEqual(['VP', 'GS', 'AGS']);
    expect(groups[0].candidates).toEqual([]);
    expect(groups[1].candidates).toHaveLength(1);
    expect(groups[1].candidates[0].name).toBe('Approved Person');
    expect(JSON.stringify(res.body)).not.toMatch(/regNo|reg_no|email|@test/);
  });

  it('hides pending candidates from the public but not from the owner or EC', async () => {
    const { positions } = await setupElection();
    const { ag } = await voterAgent();
    const created = await ag.post('/api/nominations').send(nomination(positions[0])).expect(201);
    const cid = created.body.data.id;

    await api().get(`/api/candidates/${cid}`).expect(404);
    const stranger = await voterAgent();
    await stranger.ag.get(`/api/candidates/${cid}`).expect(404);
    const owner = await ag.get(`/api/candidates/${cid}`).expect(200);
    expect(owner.body.data.status).toBe('pending');

    const ec = await createAdmin({ email: 'ec@test.local', role: 'ec' });
    const ecAgent = agent();
    await ecAgent.post('/api/auth/admin/login').send({ email: ec.email, password: ec.password }).expect(200);
    await ecAgent.get(`/api/candidates/${cid}`).expect(200);

    await approve(cid);
    const pub = await api().get(`/api/candidates/${cid}`).expect(200);
    expect(pub.body.data).toMatchObject({ manifesto: 'What I will do.' });
    expect(pub.body.data).not.toHaveProperty('status'); // public view hides review fields
  });

  it('serves approved photos publicly and hides unapproved ones', async () => {
    const { positions } = await setupElection();
    const { ag } = await voterAgent();
    const created = await ag.post('/api/nominations').send(nomination(positions[0])).expect(201);
    const cid = created.body.data.id;
    await ag.put('/api/nominations/me/photo').set('Content-Type', 'image/png').send(await png()).expect(200);

    await api().get(`/api/candidates/${cid}/photo`).expect(404);
    await approve(cid);
    const res = await api().get(`/api/candidates/${cid}/photo`).expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('filters by position', async () => {
    const { positions } = await setupElection();
    const res = await api().get(`/api/candidates?positionId=${positions[2]}`).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].position.nameEn).toBe('AGS');
  });
});

describe('Panels (FR-05)', () => {
  beforeEach(resetDb);

  async function candidateAgent(positionId, overrides) {
    const ctx = await voterAgent(overrides);
    const res = await ctx.ag.post('/api/nominations').send(nomination(positionId)).expect(201);
    return { ...ctx, candidateId: res.body.data.id };
  }

  it('creates a panel with the creator as first member, and updates it', async () => {
    const { positions } = await setupElection();
    const { ag } = await candidateAgent(positions[0]);
    const created = await ag
      .post('/api/panels')
      .send({ name: 'Unity Panel', slogan: 'Together', manifesto: 'Joint manifesto' })
      .expect(201);
    expect(created.body.data).toMatchObject({ name: 'Unity Panel', isCreator: true, totalMembers: 1 });

    const me = await ag.get('/api/nominations/me').expect(200);
    expect(me.body.data.nomination.panel.name).toBe('Unity Panel');
    expect(me.body.data.ownedPanel.name).toBe('Unity Panel');

    const upd = await ag.patch(`/api/panels/${created.body.data.id}`).send({ slogan: 'Stronger' }).expect(200);
    expect(upd.body.data.slogan).toBe('Stronger');

    const list = await api().get('/api/panels').expect(200);
    expect(list.body.data).toHaveLength(1);
  });

  it('needs a nomination, a unique name and only one panel per creator', async () => {
    const { positions } = await setupElection();
    const plain = await voterAgent();
    const none = await plain.ag.post('/api/panels').send({ name: 'No Nomination' }).expect(409);
    expect(none.body.error.code).toBe('NOMINATION_REQUIRED');

    const a = await candidateAgent(positions[0]);
    await a.ag.post('/api/panels').send({ name: 'Alpha' }).expect(201);
    const twice = await a.ag.post('/api/panels').send({ name: 'Alpha Two' }).expect(409);
    expect(twice.body.error.code).toBe('ALREADY_PANEL_CREATOR');

    const b = await candidateAgent(positions[1]);
    const dup = await b.ag.post('/api/panels').send({ name: 'Alpha' }).expect(409);
    expect(dup.body.error.code).toBe('PANEL_NAME_TAKEN');
  });

  it('lets candidates join, leave (independent), and be removed by the creator', async () => {
    const { positions } = await setupElection();
    const leader = await candidateAgent(positions[0]);
    const panel = await leader.ag.post('/api/panels').send({ name: 'Alpha' }).expect(201);
    const pid = panel.body.data.id;

    const member = await candidateAgent(positions[1]);
    const joined = await member.ag.post(`/api/panels/${pid}/join`).expect(200);
    expect(joined.body.data.panel.id).toBe(pid);

    const left = await member.ag.delete('/api/panels/membership/me').expect(200);
    expect(left.body.data.panel).toBeNull();

    await member.ag.post(`/api/panels/${pid}/join`).expect(200);
    await leader.ag.delete(`/api/panels/${pid}/members/${member.candidateId}`).expect(200);
    const detail = await leader.ag.get(`/api/panels/${pid}`).expect(200);
    expect(detail.body.data.members).toHaveLength(1);

    // not the creator -> cannot remove or edit
    const outsider = await candidateAgent(positions[2]);
    const forb = await outsider.ag.patch(`/api/panels/${pid}`).send({ name: 'Hijack' }).expect(403);
    expect(forb.body.error.code).toBe('NOT_PANEL_CREATOR');
  });

  it('allows only one candidate per position in a panel', async () => {
    const { positions } = await setupElection();
    const leader = await candidateAgent(positions[0]);
    const panel = await leader.ag.post('/api/panels').send({ name: 'Alpha' }).expect(201);
    const rival = await candidateAgent(positions[0]);
    const res = await rival.ag.post(`/api/panels/${panel.body.data.id}/join`).expect(409);
    expect(res.body.error.code).toBe('PANEL_POSITION_TAKEN');
  });

  it('keeps the creator in their own panel until they disband it', async () => {
    const { positions } = await setupElection();
    const leader = await candidateAgent(positions[0]);
    const panel = await leader.ag.post('/api/panels').send({ name: 'Alpha' }).expect(201);
    const other = await candidateAgent(positions[1]);
    const pid = panel.body.data.id;
    await other.ag.post(`/api/panels/${pid}/join`).expect(200);

    const l = await leader.ag.delete('/api/panels/membership/me').expect(409);
    expect(l.body.error.code).toBe('CREATOR_CANNOT_LEAVE');
    await leader.ag.delete('/api/nominations/me').expect(409);

    await leader.ag.delete(`/api/panels/${pid}`).expect(200);
    const me = await other.ag.get('/api/nominations/me').expect(200);
    expect(me.body.data.nomination.panel).toBeNull(); // members become independents
    await api().get(`/api/panels/${pid}`).expect(404);
  });

  it('shows only approved members publicly, all members to the creator', async () => {
    const { positions } = await setupElection();
    const leader = await candidateAgent(positions[0]);
    const panel = await leader.ag.post('/api/panels').send({ name: 'Alpha' }).expect(201);
    const pid = panel.body.data.id;
    const other = await candidateAgent(positions[1]);
    await other.ag.post(`/api/panels/${pid}/join`).expect(200);
    await approve(other.candidateId);

    const pub = await api().get(`/api/panels/${pid}`).expect(200);
    expect(pub.body.data.members.map((m) => m.id)).toEqual([other.candidateId]);
    expect(pub.body.data.memberCount).toBe(1);
    expect(pub.body.data.members[0]).not.toHaveProperty('status');

    const own = await leader.ag.get(`/api/panels/${pid}`).expect(200);
    expect(own.body.data.members).toHaveLength(2);
  });

  it('uploads a panel logo (creator only) and serves it publicly', async () => {
    const { positions } = await setupElection();
    const leader = await candidateAgent(positions[0]);
    const panel = await leader.ag.post('/api/panels').send({ name: 'Alpha' }).expect(201);
    const pid = panel.body.data.id;

    await api().get(`/api/panels/${pid}/logo`).expect(404);
    const res = await leader.ag
      .put(`/api/panels/${pid}/logo`)
      .set('Content-Type', 'image/png')
      .send(await png(900, 900))
      .expect(200);
    expect(res.body.data.logoUrl).toBe(`/api/panels/${pid}/logo`);

    const logo = await api().get(`/api/panels/${pid}/logo`).expect(200);
    expect((await sharp(logo.body).metadata()).width).toBeLessThanOrEqual(512);

    const other = await candidateAgent(positions[1]);
    await other.ag
      .put(`/api/panels/${pid}/logo`)
      .set('Content-Type', 'image/png')
      .send(await png())
      .expect(403);
  });

  it('is locked once voting has started', async () => {
    const { positions } = await setupElection();
    const leader = await candidateAgent(positions[0]);
    const panel = await leader.ag.post('/api/panels').send({ name: 'Alpha' }).expect(201);
    await query("UPDATE elections SET starts_at = now() - interval '1 minute'");
    const res = await leader.ag.patch(`/api/panels/${panel.body.data.id}`).send({ slogan: 'x' }).expect(409);
    expect(res.body.error.code).toBe('ELECTION_LOCKED');
  });
});
