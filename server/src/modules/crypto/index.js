// M1 — ballot encryption (FR-11 extension). Frozen signatures:
//
//   crypto.encryptBallot(choices, publicKeyPem)  -> string   (M4, when a vote is cast)
//   crypto.decryptBallot(blob, privateKeyPem)    -> choices  (M2, at counting, in memory)
//
// Hybrid encryption with Node's built-in crypto:
//   * a fresh random AES-256-GCM key encrypts the choices (GCM also detects tampering);
//   * the election's RSA-OAEP (SHA-256) public key encrypts that AES key.
// Only the EC's private key file can open a ballot, and the server never stores it.
//
// The plaintext is padded to a fixed size so every ballot's ciphertext has the
// same length: ciphertext size cannot reveal how many posts a voter filled in.
//
// Blob format (one string, safe to store in a text column):
//   v1.<rsa-encrypted AES key>.<iv>.<auth tag>.<ciphertext>   (each part base64url)
import nodeCrypto from 'node:crypto';
import { query } from '../../core/db.js';
import { badRequest } from '../../core/errors.js';

const VERSION = 'v1';
const PAD_TO = 4096; // bytes; a full 28-post ballot is far smaller
const MIN_RSA_BITS = 2048;

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const unb64 = (str) => Buffer.from(str, 'base64url');

const OAEP = { padding: nodeCrypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' };

/** Parses a PEM public key and checks it is RSA with at least 2048 bits. Throws 400 otherwise. */
export function parsePublicKey(pem) {
  let key;
  try {
    key = nodeCrypto.createPublicKey(pem);
  } catch {
    throw badRequest('INVALID_PUBLIC_KEY', 'This is not a valid public key file.');
  }
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < MIN_RSA_BITS) {
    throw badRequest('INVALID_PUBLIC_KEY', `The key must be an RSA key of at least ${MIN_RSA_BITS} bits.`);
  }
  return key;
}

/** Short SHA-256 fingerprint of a public key, shown to EC and observers so they can compare keys. */
export function fingerprint(pem) {
  const der = parsePublicKey(pem).export({ type: 'spki', format: 'der' });
  const hex = nodeCrypto.createHash('sha256').update(der).digest('hex');
  return hex.slice(0, 32).match(/.{4}/g).join(':');
}

function pad(json) {
  const body = Buffer.from(json, 'utf8');
  if (body.length + 4 > PAD_TO) throw new Error('Ballot is too large to encrypt');
  const out = Buffer.alloc(PAD_TO); // zero-filled
  out.writeUInt32BE(body.length, 0);
  body.copy(out, 4);
  return out;
}

function unpad(buf) {
  const len = buf.readUInt32BE(0);
  if (len > buf.length - 4) throw new Error('Corrupt ballot');
  return buf.subarray(4, 4 + len).toString('utf8');
}

/**
 * Encrypts a ballot's choices (any JSON value, e.g. [{ positionId, candidateId }])
 * with the election's public key. Returns a string for ballots.encrypted_choices.
 */
export function encryptBallot(choices, publicKeyPem) {
  const publicKey = parsePublicKey(publicKeyPem);
  const aesKey = nodeCrypto.randomBytes(32);
  const iv = nodeCrypto.randomBytes(12);
  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(pad(JSON.stringify(choices))), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wrappedKey = nodeCrypto.publicEncrypt({ key: publicKey, ...OAEP }, aesKey);
  return [VERSION, b64(wrappedKey), b64(iv), b64(tag), b64(ciphertext)].join('.');
}

/**
 * Opens one ballot with the EC's private key (PEM, as downloaded from the
 * key page). Throws if the key is wrong or the ballot was altered.
 */
export function decryptBallot(blob, privateKeyPem) {
  const parts = typeof blob === 'string' ? blob.split('.') : [];
  if (parts.length !== 5 || parts[0] !== VERSION) throw new Error('Unknown ballot format');
  const [, wrappedKey, iv, tag, ciphertext] = parts.map((p, i) => (i === 0 ? p : unb64(p)));
  const privateKey =
    typeof privateKeyPem === 'string' ? nodeCrypto.createPrivateKey(privateKeyPem) : privateKeyPem;
  const aesKey = nodeCrypto.privateDecrypt({ key: privateKey, ...OAEP }, wrappedKey);
  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(unpad(plain));
}

/**
 * Checks that an uploaded private key matches the election's public key,
 * so M2 can reject the wrong file before decrypting anything.
 */
export function keyPairMatches(privateKeyPem, publicKeyPem) {
  try {
    const priv = nodeCrypto.createPrivateKey(privateKeyPem);
    const pubFromPriv = nodeCrypto.createPublicKey(priv).export({ type: 'spki', format: 'der' });
    const pub = parsePublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
    return nodeCrypto.timingSafeEqual(pubFromPriv, pub);
  } catch {
    return false;
  }
}

/** The public key of an election (PEM) or null if the EC has not uploaded one yet. */
export async function getPublicKey(electionId, client = null) {
  const q = client ? client.query.bind(client) : query;
  const { rows } = await q('SELECT public_key FROM elections WHERE id = $1', [electionId]);
  return rows[0]?.public_key ?? null;
}

export const crypto = {
  encryptBallot,
  decryptBallot,
  keyPairMatches,
  getPublicKey,
  fingerprint,
  parsePublicKey,
};

export default crypto;
