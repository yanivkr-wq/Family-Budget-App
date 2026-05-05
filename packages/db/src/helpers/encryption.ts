import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM column-level encryption.
// Used for: bank credentials, TOTP secrets, chat message contents.
//
// Format on disk (base64): version || nonce(12) || tag(16) || ciphertext
// version = 0x01

const VERSION = 0x01;
const NONCE_LEN = 12;
const TAG_LEN = 16;

function getKey(masterKey?: string): Buffer {
  const k = masterKey ?? process.env.MASTER_KEY;
  if (!k) throw new Error('MASTER_KEY env var is required for encryption');
  const buf = Buffer.from(k, 'base64');
  if (buf.length !== 32) {
    throw new Error('MASTER_KEY must decode to 32 bytes (256 bits) of base64');
  }
  return buf;
}

export function encryptString(plaintext: string, masterKey?: string): string {
  const key = getKey(masterKey);
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const out = Buffer.concat([Buffer.from([VERSION]), nonce, tag, ct]);
  return out.toString('base64');
}

export function decryptString(encoded: string, masterKey?: string): string {
  const key = getKey(masterKey);
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length < 1 + NONCE_LEN + TAG_LEN) {
    throw new Error('Ciphertext too short');
  }
  const version = buf.readUInt8(0);
  if (version !== VERSION) throw new Error(`Unknown ciphertext version: ${version}`);
  const nonce = buf.subarray(1, 1 + NONCE_LEN);
  const tag = buf.subarray(1 + NONCE_LEN, 1 + NONCE_LEN + TAG_LEN);
  const ct = buf.subarray(1 + NONCE_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

export function encryptJson(value: unknown, masterKey?: string): string {
  return encryptString(JSON.stringify(value), masterKey);
}

export function decryptJson<T = unknown>(encoded: string, masterKey?: string): T {
  return JSON.parse(decryptString(encoded, masterKey)) as T;
}
