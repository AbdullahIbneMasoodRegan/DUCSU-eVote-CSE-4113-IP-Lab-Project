// M4 — basic photo capture (FR-19): camera permission, live preview, capture to a JPEG via <canvas>.
// The photo stays in memory (a Blob) until it is submitted with the vote; nothing is stored on the device.
// The server re-encodes it and strips all metadata.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button } from '../../components/ui';

function failureKey(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError' || err?.name === 'PermissionDeniedError') {
    return 'denied';
  }
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') return 'notFound';
  return 'error';
}

/**
 * @param {{ onChange: (photo: Blob | null) => void }} props
 *   onChange(blob) when a photo is captured, onChange(null) when it is cleared.
 */
export default function PhotoCapture({ onChange }) {
  const { t } = useTranslation('voting');
  const [status, setStatus] = useState('idle'); // idle | starting | live | captured
  const [failure, setFailure] = useState(null); // denied | notFound | unsupported | error
  const [previewUrl, setPreviewUrl] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Release the camera and the preview URL when leaving the page.
  useEffect(() => stopCamera, [stopCamera]);
  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);

  // Attach the stream once the <video> element exists.
  useEffect(() => {
    if (status === 'live' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      Promise.resolve(videoRef.current.play?.()).catch(() => {});
    }
  }, [status]);

  async function start() {
    setFailure(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setFailure('unsupported');
      return;
    }
    setStatus('starting');
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      setStatus('live');
    } catch (err) {
      setFailure(failureKey(err));
      setStatus('idle');
    }
  }

  function capture() {
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video?.videoWidth || 640;
    canvas.height = video?.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setFailure('error');
          return;
        }
        stopCamera();
        setPreviewUrl(URL.createObjectURL(blob));
        setStatus('captured');
        onChange(blob);
      },
      'image/jpeg',
      0.85,
    );
  }

  function retake() {
    setPreviewUrl(null);
    onChange(null);
    setStatus('idle');
    start();
  }

  return (
    <div className="space-y-3">
      {failure && <Alert tone="error">{t(`photo.${failure}`)}</Alert>}

      {status === 'idle' && (
        <Button onClick={start}>{t('photo.turnOn')}</Button>
      )}
      {status === 'starting' && <p className="text-slate-700">{t('photo.starting')}</p>}

      {status === 'live' && (
        <>
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            aria-label={t('photo.livePreview')}
            className="w-full max-w-sm -scale-x-100 rounded-lg border border-slate-300 bg-black"
          />
          <div>
            <Button onClick={capture}>{t('photo.capture')}</Button>
          </div>
        </>
      )}

      {status === 'captured' && previewUrl && (
        <>
          <img
            src={previewUrl}
            alt={t('photo.captured')}
            className="w-full max-w-sm -scale-x-100 rounded-lg border border-slate-300"
          />
          <Alert tone="success">{t('photo.ready')}</Alert>
          <div>
            <Button variant="secondary" onClick={retake}>
              {t('photo.retake')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
