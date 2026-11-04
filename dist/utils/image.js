"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_IMAGE_DIMENSION = exports.MAX_IMAGE_BYTES = void 0;
exports.assetUrl = assetUrl;
exports.validateImageUpload = validateImageUpload;
const image_size_1 = require("image-size");
exports.MAX_IMAGE_BYTES = 500 * 1024;
exports.MAX_IMAGE_DIMENSION = 2000;
// Only these two types are accepted. SVG is excluded on purpose: it can carry script.
const allowedTypes = {
    'image/png': { signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], headerType: 'png' },
    'image/jpeg': { signature: [0xff, 0xd8, 0xff], headerType: 'jpg' }
};
const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
/** Public path of a stored image, served by GET /api/assets/:assetId. */
function assetUrl(assetId) {
    return assetId ? `/api/assets/${assetId}` : null;
}
/**
 * Validates an uploaded image from its real content: the declared type, the decoded bytes' file signature,
 * the size and the dimensions read from the header. The file name and declared type alone are never trusted.
 */
function validateImageUpload(input) {
    if (!input || typeof input !== 'object')
        return { ok: false, error: 'An image with data and mimeType is required' };
    const { data, mimeType } = input;
    if (typeof mimeType !== 'string' || !(mimeType.toLowerCase() in allowedTypes)) {
        return { ok: false, error: 'Only PNG and JPEG images are accepted (mimeType image/png or image/jpeg)' };
    }
    const declaredType = mimeType.toLowerCase();
    if (typeof data !== 'string' || !data)
        return { ok: false, error: 'data must be the image encoded as base64' };
    const encoded = data.replace(/\s/g, '');
    if (encoded.length % 4 !== 0 || !base64Pattern.test(encoded)) {
        return { ok: false, error: 'data must be valid base64' };
    }
    // Reject before decoding when the encoded length alone is already over the limit.
    if (Math.floor((encoded.length * 3) / 4) - (encoded.match(/=+$/)?.[0].length ?? 0) > exports.MAX_IMAGE_BYTES) {
        return { ok: false, error: `The image must be ${exports.MAX_IMAGE_BYTES / 1024} KB or smaller` };
    }
    const buffer = Buffer.from(encoded, 'base64');
    if (buffer.length === 0)
        return { ok: false, error: 'The image is empty' };
    if (buffer.length > exports.MAX_IMAGE_BYTES)
        return { ok: false, error: `The image must be ${exports.MAX_IMAGE_BYTES / 1024} KB or smaller` };
    const { signature, headerType } = allowedTypes[declaredType];
    if (buffer.length < signature.length || !signature.every((byte, index) => buffer[index] === byte)) {
        return { ok: false, error: `The file content is not a valid ${declaredType === 'image/png' ? 'PNG' : 'JPEG'} image` };
    }
    let dimensions;
    try {
        dimensions = (0, image_size_1.imageSize)(buffer);
    }
    catch {
        return { ok: false, error: 'The image could not be read. It may be corrupted.' };
    }
    if (dimensions.type !== headerType || !dimensions.width || !dimensions.height) {
        return { ok: false, error: 'The image could not be read. It may be corrupted.' };
    }
    if (dimensions.width > exports.MAX_IMAGE_DIMENSION || dimensions.height > exports.MAX_IMAGE_DIMENSION) {
        return { ok: false, error: `The image must be at most ${exports.MAX_IMAGE_DIMENSION} by ${exports.MAX_IMAGE_DIMENSION} pixels` };
    }
    return {
        ok: true,
        image: { data: buffer, mimeType: declaredType, sizeBytes: buffer.length, width: dimensions.width, height: dimensions.height }
    };
}
exports.default = { validateImageUpload, assetUrl, MAX_IMAGE_BYTES: exports.MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION: exports.MAX_IMAGE_DIMENSION };
