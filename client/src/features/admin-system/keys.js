// M1 — ballot key pair, generated in the EC's browser with Web Crypto (FR-11 extension).
// The private key is only ever offered as a download; it is never sent to the server.

const ALGORITHM = {
  name: 'RSA-OAEP',
  modulusLength: 3072,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};

function toBase64(buffer) {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function toPem(label, buffer) {
  const lines = toBase64(buffer).match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

function pemBody(pem) {
  return pem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/\s+/g, '');
}

/**
 * Short fingerprint of a public key: first 128 bits of SHA-256 over the key,
 * in groups of 4 hex digits. Matches the server's crypto.fingerprint().
 */
export async function fingerprintOf(publicKeyPem) {
  const digest = await crypto.subtle.digest('SHA-256', fromBase64(pemBody(publicKeyPem)));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 32).match(/.{4}/g).join(':');
}

/** Generates a new RSA-OAEP 3072-bit key pair. Returns both halves as PEM strings. */
export async function generateBallotKeyPair() {
  const pair = await crypto.subtle.generateKey(ALGORITHM, true, ['encrypt', 'decrypt']);
  const publicKey = toPem('PUBLIC KEY', await crypto.subtle.exportKey('spki', pair.publicKey));
  const privateKey = toPem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  return { publicKey, privateKey, fingerprint: await fingerprintOf(publicKey) };
}

/** Offers a text file as a download. */
export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-pem-file' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
