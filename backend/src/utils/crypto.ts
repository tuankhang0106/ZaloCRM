import crypto from 'node:crypto';
import { config } from '../config/index.js';

// Derive 32-byte key from config.encryptionKey using SHA-256
const getKey = (): Buffer => {
  return crypto.createHash('sha256').update(config.encryptionKey).digest();
};

/**
 * Encrypt data using AES-256-GCM.
 * Output format: "enc:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
export function encryptData(data: unknown): string {
  if (data === null || data === undefined) return '';
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  const iv = crypto.randomBytes(12); // 96-bit IV
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);

  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt data that was encrypted with encryptData().
 * Backward compatible with legacy unencrypted objects or raw JSON strings.
 */
export function decryptData<T = any>(encryptedValue: unknown): T | null {
  if (!encryptedValue) return null;

  // If already an object (e.g. legacy Prisma Json object), return as-is
  if (typeof encryptedValue === 'object') {
    return encryptedValue as T;
  }

  const str = String(encryptedValue);
  if (!str.startsWith('enc:')) {
    try {
      return JSON.parse(str) as T;
    } catch {
      return str as unknown as T;
    }
  }

  const parts = str.split(':');
  if (parts.length !== 4) {
    return null;
  }

  try {
    const [, ivHex, tagHex, cipherHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(cipherHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    try {
      return JSON.parse(decrypted) as T;
    } catch {
      return decrypted as unknown as T;
    }
  } catch (err) {
    return null;
  }
}
