import type { Request } from 'express';

/**
 * The visitor's address for rate limits. Behind Cloudflare Tunnel or a reverse
 * proxy every request comes from the proxy, so prefer the address it passes on.
 * (A visitor reaching the port directly could fake these headers; that only
 * affects these soft limits, never sign-in checks themselves.)
 */
export function clientIp(req: Request): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  return req.ip ?? 'unknown';
}
