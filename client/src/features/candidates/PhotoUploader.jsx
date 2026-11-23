// M3 — choose, preview and upload a JPEG/PNG (max 2 MB) for a candidate photo or panel logo.
// The server re-encodes it and strips metadata; this only checks the obvious mistakes early.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Avatar, Button } from '../../components/ui';
import { IMAGE_TYPES, MAX_IMAGE_BYTES, errorMessage } from './format.js';
import { uploadImage } from './upload.js';

export default function PhotoUploader({ path, currentUrl, name, heading, hint, uploadLabel, errorScope, onUploaded }) {
  const { t } = useTranslation('candidates');
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  // Changes after each upload so the browser does not show the old cached image.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function onPick(e) {
    const picked = e.target.files?.[0];
    setDone(false);
    setError('');
    if (!picked) return setFile(null);
    if (!IMAGE_TYPES.includes(picked.type)) {
      setFile(null);
      return setError(t('nomination.photo.wrongType'));
    }
    if (picked.size > MAX_IMAGE_BYTES) {
      setFile(null);
      return setError(t('nomination.photo.tooBig'));
    }
    return setFile(picked);
  }

  async function onUpload() {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      await uploadImage(path, file);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      setVersion((v) => v + 1);
      setDone(true);
      onUploaded?.();
    } catch (err) {
      setError(errorMessage(t, errorScope, err));
    } finally {
      setBusy(false);
    }
  }

  const shown = preview ?? (currentUrl ? `${currentUrl}${version ? `?v=${version}` : ''}` : null);
  const inputId = `${path.replace(/\W+/g, '-')}-file`;

  return (
    <div>
      <h3 className="font-semibold text-slate-900">{heading}</h3>
      <div className="mt-2 flex items-center gap-4">
        <Avatar src={shown} name={name} size={80} alt={t('nomination.photo.alt')} />
        <div className="min-w-0">
          {!shown && <p className="text-sm text-slate-600">{t('nomination.photo.none')}</p>}
          <label
            htmlFor={inputId}
            className="inline-flex min-h-[44px] cursor-pointer items-center rounded-md border border-slate-400 bg-white px-4 py-2 font-semibold text-slate-900 focus-within:outline focus-within:outline-2 focus-within:outline-brand-700 hover:bg-slate-100"
          >
            {currentUrl || file ? t('nomination.photo.replace') : t('nomination.photo.choose')}
          </label>
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png"
            className="sr-only"
            onChange={onPick}
          />
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-600">{hint ?? t('nomination.photo.hint')}</p>
      {file && (
        <Button className="mt-3" loading={busy} onClick={onUpload}>
          {busy ? t('nomination.photo.uploading') : uploadLabel ?? t('nomination.photo.upload')}
        </Button>
      )}
      {error && <Alert tone="error" className="mt-3">{error}</Alert>}
      {done && !error && <Alert tone="success" className="mt-3">{t('nomination.photo.uploaded')}</Alert>}
    </div>
  );
}
