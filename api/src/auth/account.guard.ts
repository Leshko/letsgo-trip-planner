import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { User } from '../entities';
import { AuthService } from './auth.service';

/** Account sessions travel in their own header so they never mix with a trip member's token. */
export const ACCOUNT_HEADER = 'x-account';

export interface AccountRequest extends Request {
  user?: User;
  accountToken?: string;
}

export function accountToken(req: Request): string {
  const v = req.headers[ACCOUNT_HEADER];
  return (Array.isArray(v) ? v[0] : (v ?? '')).trim();
}

/** Requires a signed-in account. */
@Injectable()
export class AccountGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AccountRequest>();
    const token = accountToken(req);
    const user = token ? await this.auth.userForToken(token) : null;
    if (!user) throw new UnauthorizedException('Please sign in');
    req.user = user;
    req.accountToken = token;
    return true;
  }
}

/** Uses the account when there is one; never blocks. */
@Injectable()
export class OptionalAccountGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AccountRequest>();
    const token = accountToken(req);
    if (token) {
      const user = await this.auth.userForToken(token);
      if (user) {
        req.user = user;
        req.accountToken = token;
      }
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AccountRequest>().user ?? null,
);
