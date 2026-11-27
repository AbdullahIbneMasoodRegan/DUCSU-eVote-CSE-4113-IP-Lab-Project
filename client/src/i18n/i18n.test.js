// M1 — every English key has a Bangla translation (FR-18).
// Every namespace must have a Bangla file (Week 7 deadline has passed).
// For a full report with warnings: npm run i18n:check --prefix client
import { describe, it, expect } from 'vitest';

const files = import.meta.glob('./*/*.json', { eager: true });

function keys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

const byLang = { en: {}, bn: {} };
for (const [path, mod] of Object.entries(files)) {
  const [, lang, ns] = path.match(/^\.\/(\w+)\/([\w-]+)\.json$/);
  byLang[lang][ns] = mod.default ?? mod;
}

describe('translations', () => {
  for (const ns of Object.keys(byLang.en)) {
    it(`bn/${ns}.json exists and has every key in en/${ns}.json`, () => {
      expect(byLang.bn[ns], `missing file bn/${ns}.json`).toBeDefined();
      const missing = keys(byLang.en[ns]).filter((k) => !keys(byLang.bn[ns]).includes(k));
      expect(missing).toEqual([]);
    });
  }
});
