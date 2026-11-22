// M3 — image upload helpers (FR-05).
// Uploads arrive as a raw JPEG/PNG body (Content-Type: image/jpeg | image/png),
// max 2 MB. We never trust the claimed type: sharp decodes the real bytes, and
// the image is RE-ENCODED, which also strips EXIF/GPS metadata.
import express from 'express';
import sharp from 'sharp';
import { badRequest } from '../../core/errors.js';

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Route middleware: parses a raw image body (413 if over 2 MB). */
export const rawImage = express.raw({
  type: ['image/jpeg', 'image/png'],
  limit: MAX_UPLOAD_BYTES,
});

/**
 * Validate and re-encode an uploaded image.
 * @param {Buffer} body  req.body from rawImage
 * @param {{ maxSide: number }} opts  longest allowed side in pixels
 * @returns {Promise<{ mime: string, data: Buffer }>}
 */
export async function reencodeImage(body, { maxSide }) {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw badRequest(
      'INVALID_IMAGE',
      'Send the image as the request body with Content-Type image/jpeg or image/png.',
    );
  }
  try {
    const meta = await sharp(body).metadata();
    if (meta.format !== 'jpeg' && meta.format !== 'png') {
      throw new Error('unsupported format');
    }
    const pipeline = sharp(body)
      .rotate() // apply EXIF orientation before the metadata is dropped
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
    // sharp drops all metadata unless .withMetadata() is called.
    if (meta.format === 'png') {
      return { mime: 'image/png', data: await pipeline.png({ compressionLevel: 9 }).toBuffer() };
    }
    return { mime: 'image/jpeg', data: await pipeline.jpeg({ quality: 82 }).toBuffer() };
  } catch {
    throw badRequest('INVALID_IMAGE', 'That file is not a valid JPEG or PNG image.');
  }
}
