import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';

export const sha256 = (v: string) =>
  createHash('sha256').update(v).digest('hex');

export const randomToken = (bytes = 32) =>
  randomBytes(bytes).toString('base64url');

export const sixDigits = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export const sameHash = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
