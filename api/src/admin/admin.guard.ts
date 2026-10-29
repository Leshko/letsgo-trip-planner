import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { clientIp } from '../common/client-ip';

const MIN_KEY_LENGTH = 16;
const failures = new Map<string, { n: number; at: number }>();

/** Admin key from ADMIN_KEY; off (403) when it isn't set or is too short to be safe. */
export function adminKey(): string {
  const k = (process.env.ADMIN_KEY ?? '').trim();
  return k.length >= MIN_KEY_LENGTH ? k : '';
}

const digest = (v: string) => createHash('sha256').update(v).digest();

/** Requires X-Admin-Key to match ADMIN_KEY. Ten wrong tries per minute per address, then a pause. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const key = adminKey();
    if (!key)
      throw new ForbiddenException(
        "The admin screen isn't turned on. Add ADMIN_KEY to letsgo.env on the server.",
      );
    const ip = clientIp(req);
    const f = failures.get(ip);
    const now = Date.now();
    if (f && now - f.at < 60_000 && f.n >= 10)
      throw new HttpException(
        'Too many wrong keys. Wait a minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const given = String(req.headers['x-admin-key'] ?? '');
    if (!given || !timingSafeEqual(digest(given), digest(key))) {
      const cur = f && now - f.at < 60_000 ? f : { n: 0, at: now };
      cur.n += 1;
      failures.set(ip, cur);
      if (failures.size > 10_000) failures.clear();
      throw new UnauthorizedException('Wrong admin key');
    }
    failures.delete(ip);
    return true;
  }
}
