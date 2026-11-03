// M1 — i18n setup. Each feature owner adds THEIR OWN namespace files:
//   src/i18n/en/voting.json  and  src/i18n/bn/voting.json
// They are picked up automatically; no need to edit this file.
// Use them with:  const { t } = useTranslation('voting');  t('review.title')
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const files = import.meta.glob('./*/*.json', { eager: true });

const resources = {};
for (const [path, mod] of Object.entries(files)) {
  const [, lang, ns] = path.match(/^\.\/(\w+)\/([\w-]+)\.json$/) ?? [];
  if (!lang) continue;
  resources[lang] ??= {};
  resources[lang][ns] = mod.default ?? mod;
}

export const LANGUAGES = ['en', 'bn'];
const STORAGE_KEY = 'lang';

function initialLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LANGUAGES.includes(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  return 'en';
}

i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: 'en', // missing Bangla strings fall back to English
  ns: Object.keys(resources.en ?? {}),
  defaultNS: 'common',
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
});

function applyLang(lng) {
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
}
applyLang(i18n.language);

/** Switch language and remember it in this browser. */
export function setLanguage(lng) {
  if (!LANGUAGES.includes(lng)) return;
  i18n.changeLanguage(lng);
  applyLang(lng);
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    /* storage unavailable */
  }
}

/** Format a UTC ISO time for display in Dhaka time, in the current language. */
export function formatDhakaTime(iso, opts = { dateStyle: 'medium', timeStyle: 'short' }) {
  const locale = i18n.language === 'bn' ? 'bn-BD' : 'en-GB';
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'Asia/Dhaka' }).format(new Date(iso));
}

export default i18n;
