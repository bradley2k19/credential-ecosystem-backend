import crypto from 'crypto';

export function generateCertificateHash(bufferOrString: Buffer | string) {
  const hash = crypto.createHash('sha256');
  hash.update(bufferOrString);
  return hash.digest('hex');
}

export default { generateCertificateHash };
