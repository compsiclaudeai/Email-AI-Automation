import crypto from 'crypto';
import { env } from '../config/env';

const ALGO = 'aes-256-gcm';

function key(): Buffer {
  const buf = Buffer.from(env.tokenKey, 'hex');
  if (buf.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes of hex (64 characters)');
  }
  return buf;
}

/** Encrypts an OAuth refresh token before it is written to MongoDB. */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted token');
  const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
