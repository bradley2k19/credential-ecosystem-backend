import { imageSize } from 'image-size';

export const MAX_IMAGE_BYTES = 500 * 1024;
export const MAX_IMAGE_DIMENSION = 2000;

// Only these two types are accepted. SVG is excluded on purpose: it can carry script.
const allowedTypes = {
  'image/png': { signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], headerType: 'png' },
  'image/jpeg': { signature: [0xff, 0xd8, 0xff], headerType: 'jpg' }
} as const;

type AllowedMimeType = keyof typeof allowedTypes;

export interface ValidatedImage {
  data: Buffer;
  mimeType: AllowedMimeType;
  sizeBytes: number;
  width: number;
  height: number;
}

export type ImageValidationResult = { ok: true; image: ValidatedImage } | { ok: false; error: string };

const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;

/** Public path of a stored image, served by GET /api/assets/:assetId. */
export function assetUrl(assetId: string | null) {
  return assetId ? `/api/assets/${assetId}` : null;
}

/**
 * Validates an uploaded image from its real content: the declared type, the decoded bytes' file signature,
 * the size and the dimensions read from the header. The file name and declared type alone are never trusted.
 */
export function validateImageUpload(input: unknown): ImageValidationResult {
  if (!input || typeof input !== 'object') return { ok: false, error: 'An image with data and mimeType is required' };
  const { data, mimeType } = input as { data?: unknown; mimeType?: unknown };

  if (typeof mimeType !== 'string' || !(mimeType.toLowerCase() in allowedTypes)) {
    return { ok: false, error: 'Only PNG and JPEG images are accepted (mimeType image/png or image/jpeg)' };
  }
  const declaredType = mimeType.toLowerCase() as AllowedMimeType;

  if (typeof data !== 'string' || !data) return { ok: false, error: 'data must be the image encoded as base64' };
  const encoded = data.replace(/\s/g, '');
  if (encoded.length % 4 !== 0 || !base64Pattern.test(encoded)) {
    return { ok: false, error: 'data must be valid base64' };
  }
  // Reject before decoding when the encoded length alone is already over the limit.
  if (Math.floor((encoded.length * 3) / 4) - (encoded.match(/=+$/)?.[0].length ?? 0) > MAX_IMAGE_BYTES) {
    return { ok: false, error: `The image must be ${MAX_IMAGE_BYTES / 1024} KB or smaller` };
  }

  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length === 0) return { ok: false, error: 'The image is empty' };
  if (buffer.length > MAX_IMAGE_BYTES) return { ok: false, error: `The image must be ${MAX_IMAGE_BYTES / 1024} KB or smaller` };

  const { signature, headerType } = allowedTypes[declaredType];
  if (buffer.length < signature.length || !signature.every((byte, index) => buffer[index] === byte)) {
    return { ok: false, error: `The file content is not a valid ${declaredType === 'image/png' ? 'PNG' : 'JPEG'} image` };
  }

  let dimensions: { width?: number; height?: number; type?: string };
  try {
    dimensions = imageSize(buffer);
  } catch {
    return { ok: false, error: 'The image could not be read. It may be corrupted.' };
  }
  if (dimensions.type !== headerType || !dimensions.width || !dimensions.height) {
    return { ok: false, error: 'The image could not be read. It may be corrupted.' };
  }
  if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) {
    return { ok: false, error: `The image must be at most ${MAX_IMAGE_DIMENSION} by ${MAX_IMAGE_DIMENSION} pixels` };
  }

  return {
    ok: true,
    image: { data: buffer, mimeType: declaredType, sizeBytes: buffer.length, width: dimensions.width, height: dimensions.height }
  };
}

export default { validateImageUpload, assetUrl, MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION };
