// M4 — receipt codes (FR-12).
// A receipt is a random, unguessable code such as DU-7KQ4-M9XP. It is generated
// with Node's cryptographic RNG and has NO link to the voter or the ballot, so
// it can be shown to the voter once and published later without revealing who
// voted for whom (secrecy rule 3).
import crypto from 'node:crypto';

// No 0/O, 1/I/L so a code read off a phone screen is never ambiguous.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const RECEIPT_PATTERN = /^DU-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

const chunk = (n) =>
  Array.from({ length: n }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');

/** A new random receipt code. randomInt is unbiased, unlike `byte % length`. */
export function generateReceiptCode() {
  return `DU-${chunk(4)}-${chunk(4)}`;
}

export default generateReceiptCode;
