// M1 — /api/admin/crypto/* : the election's ballot encryption key (FR-11 extension).
// The EC generates the key pair in the browser and uploads only the public key.
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../core/middleware/auth.js';
import { validate } from '../../core/middleware/validate.js';
import { withTransaction } from '../../core/db.js';
import { badRequest } from '../../core/errors.js';
import audit from '../audit/index.js';
import { getCurrent, assertEditable } from '../election/index.js';
import { parsePublicKey, fingerprint } from './index.js';

const router = Router();

const NO_ELECTION = () => badRequest('NO_ELECTION', 'Create the election before setting its key.');

// EC and Observer can see whether a key is set and compare its fingerprint.
router.get('/admin/crypto/public-key', requireRole('ec', 'observer'), async (req, res) => {
  const election = await getCurrent();
  if (!election) throw NO_ELECTION();
  const pem = election.publicKey ?? null;
  res.json({
    data: {
      electionId: election.id,
      hasKey: Boolean(pem),
      fingerprint: pem ? fingerprint(pem) : null,
      publicKey: pem,
      locked: election.status !== 'draft' && election.status !== 'nomination',
    },
  });
});

// EC uploads the public key. Allowed only before voting opens: replacing it
// later would leave ballots that no key on file can open.
router.put(
  '/admin/crypto/public-key',
  requireRole('ec'),
  validate({ body: z.object({ publicKey: z.string().trim().min(100).max(5000) }) }),
  async (req, res) => {
    const election = await getCurrent();
    if (!election) throw NO_ELECTION();
    await assertEditable(election);
    parsePublicKey(req.body.publicKey);
    const fp = fingerprint(req.body.publicKey);

    await withTransaction(async (client) => {
      await client.query('UPDATE elections SET public_key = $2 WHERE id = $1', [
        election.id,
        req.body.publicKey,
      ]);
      await audit.record(req, 'SET_PUBLIC_KEY', `election:${election.id} key:${fp}`, client);
    });
    res.json({ data: { electionId: election.id, hasKey: true, fingerprint: fp } });
  },
);

export default router;
