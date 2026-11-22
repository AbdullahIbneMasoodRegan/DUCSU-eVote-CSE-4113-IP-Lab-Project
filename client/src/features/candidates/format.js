// M3 — small helpers shared by the candidate pages.
import { ApiError } from '../../app/api.js';

/** Post name in the current language (falls back to English). */
export function positionName(position, lang) {
  if (!position) return '';
  return (lang === 'bn' ? position.nameBn : position.nameEn) || position.nameEn || '';
}

/**
 * Turn an API error into a translated message.
 * `t` must be the 'candidates' namespace translator; `scope` is 'nomination.errors' or 'panelManager.errors'.
 */
export function errorMessage(t, scope, err) {
  if (err instanceof ApiError && err.code && err.code !== 'VALIDATION_ERROR') {
    const key = `${scope}.${err.code}`;
    const text = t(key, { defaultValue: '' });
    if (text) return text;
  }
  if (err instanceof ApiError && err.code === 'VALIDATION_ERROR' && err.details?.length) {
    return err.details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join(' · ');
  }
  return t(`${scope}.generic`);
}

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png'];
