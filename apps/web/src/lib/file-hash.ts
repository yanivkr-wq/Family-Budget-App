import { createHash } from 'node:crypto';

/** SHA-256 hash of the file's bytes — used to detect "you already uploaded this exact file". */
export function computeFileHash(buffer: ArrayBuffer | Buffer): string {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return createHash('sha256').update(buf).digest('hex');
}
