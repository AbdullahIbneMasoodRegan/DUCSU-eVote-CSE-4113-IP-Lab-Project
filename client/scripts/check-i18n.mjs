/* global console, process */ // Node script; the client lint config assumes a browser.
// M1 — translation check for every owner's files (FR-18).
//
//   npm run i18n:check --prefix client
//
// For each namespace (en/<ns>.json):
//   MISSING   key in English but not in Bangla        -> fails (exit 1)
//   NO FILE   bn/<ns>.json does not exist              -> fails
//   EXTRA     key in Bangla but not in English         -> warning (probably renamed)
//   ENGLISH?  Bangla value has no Bangla letters       -> warning (maybe not translated)
//   {{vars}}  placeholders differ between the two      -> fails
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n');
const BANGLA = /[ঀ-৿]/;
const VARS = /{{\s*(\w+)\s*}}/g;

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') flatten(v, `${prefix}${k}.`, out);
    else out[`${prefix}${k}`] = String(v);
  }
  return out;
}

const read = (lang, ns) => {
  const file = path.join(root, lang, `${ns}.json`);
  return fs.existsSync(file) ? flatten(JSON.parse(fs.readFileSync(file, 'utf8'))) : null;
};

const vars = (s) => [...s.matchAll(VARS)].map((m) => m[1]).sort().join(',');

// Values that are fine to leave as-is in Bangla (names, codes, symbols, numbers).
const looksUntranslatable = (raw, s = raw.replace(VARS, '')) => !/[A-Za-z]{3,}/.test(s) || /^(DUCSU|OTP|PDF|CSV|URL|ID|Email|English)\b/.test(s);

let errors = 0;
let warnings = 0;
const namespaces = fs
  .readdirSync(path.join(root, 'en'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

for (const ns of namespaces) {
  const en = read('en', ns);
  const bn = read('bn', ns);
  const lines = [];
  if (!bn) {
    lines.push(`  NO FILE   bn/${ns}.json`);
    errors += 1;
  } else {
    for (const key of Object.keys(en)) {
      if (!(key in bn)) {
        lines.push(`  MISSING   ${key}`);
        errors += 1;
      } else if (vars(en[key]) !== vars(bn[key])) {
        lines.push(`  {{vars}}  ${key}: en {${vars(en[key])}} vs bn {${vars(bn[key])}}`);
        errors += 1;
      } else if (!BANGLA.test(bn[key]) && !looksUntranslatable(bn[key])) {
        lines.push(`  ENGLISH?  ${key}: "${bn[key]}"`);
        warnings += 1;
      }
    }
    for (const key of Object.keys(bn)) {
      if (!(key in en)) {
        lines.push(`  EXTRA     ${key}`);
        warnings += 1;
      }
    }
  }
  const count = Object.keys(en).length;
  console.log(`${lines.length ? '✗' : '✓'} ${ns} (${count} keys)`);
  lines.forEach((l) => console.log(l));
}

console.log(`\n${errors} error(s), ${warnings} warning(s) in ${namespaces.length} namespaces.`);
process.exitCode = errors ? 1 : 0;
