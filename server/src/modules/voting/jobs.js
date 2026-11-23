// M4 — daily job: delete voter verification photos after the dispute period (FR-19).
// Started from src/server.js only (never in tests). Audited as a system action.
import cron from 'node-cron';
import logger from '../../core/logger.js';
import { audit } from '../audit/index.js';
import { purgeExpiredPhotos } from './service.js';

/** Run the purge once; exported so tests and operators can call it directly. */
export async function runPhotoPurge(now = new Date()) {
  const deleted = await purgeExpiredPhotos(now);
  if (deleted > 0) {
    // No req => the audit helper records the actor as "system".
    await audit.record(null, 'PHOTOS_PURGED', `${deleted} photos`);
    logger.info('voter photos deleted after the dispute period', { deleted });
  }
  return deleted;
}

/** Schedule the purge for 03:15 Asia/Dhaka every day. */
export function startPhotoCleanupJob() {
  return cron.schedule(
    '15 3 * * *',
    () => {
      runPhotoPurge().catch((err) => logger.error('photo purge failed', { error: err.message }));
    },
    { timezone: 'Asia/Dhaka' },
  );
}
