// M4 — voter verification photo handling (FR-19, NFR-06).
// The browser sends a JPEG captured from a <canvas>, but we never trust it: sharp
// decodes the real bytes and RE-ENCODES them to a small JPEG, which also strips
// EXIF/GPS metadata (secrecy rule 9). The stored row has no timestamp.
import multer from 'multer';
import sharp from 'sharp';
import { AppError, badRequest } from '../../core/errors.js';

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const PHOTO_MAX_SIDE = 640;

const upload = multer({
  storage: multer.memoryStorage(), // never written to disk
  limits: {
    fileSize: MAX_PHOTO_BYTES,
    files: 1,
    fields: 4,
    fieldSize: 64 * 1024, // the `choices` JSON field
    parts: 6,
  },
});

/** Parses the multipart body of POST /api/vote (field `choices` + file `photo`). */
export function parseVoteForm(req, res, next) {
  upload.single('photo')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(413, 'PHOTO_TOO_LARGE', 'The photo is too large (max 2 MB).'));
      }
      return next(badRequest('INVALID_FORM', 'The vote form could not be read.'));
    }
    return next(err);
  });
}

/**
 * Validate and re-encode the uploaded photo. Always returns a JPEG.
 * @param {Buffer | undefined} body
 * @returns {Promise<{ mime: 'image/jpeg', data: Buffer }>}
 */
export async function reencodePhoto(body) {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw badRequest('PHOTO_REQUIRED', 'A verification photo is required to cast your vote.');
  }
  try {
    const meta = await sharp(body).metadata();
    if (meta.format !== 'jpeg' && meta.format !== 'png') throw new Error('unsupported format');
    const data = await sharp(body)
      .rotate() // apply EXIF orientation before the metadata is dropped
      .resize({ width: PHOTO_MAX_SIDE, height: PHOTO_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer(); // sharp drops all metadata unless .withMetadata() is called
    return { mime: 'image/jpeg', data };
  } catch {
    throw badRequest('INVALID_PHOTO', 'The photo is not a valid JPEG or PNG image.');
  }
}
