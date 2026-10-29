import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Request } from 'express';
import { Member, MemberAlias } from '../entities';

export interface AuthedRequest extends Request {
  member: Member;
}

/**
 * Every member belongs to exactly one trip. The bearer token identifies the
 * member; if the route has a :tripId param it must match the member's trip.
 */
@Injectable()
export class MemberGuard implements CanActivate {
  constructor(
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly ds: DataSource,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    let token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    // Downloads (<a href>) can't set headers, so GET may carry ?token=. Trade-off: the token can
    // show up in proxy logs and browser history; it is the same long-lived bearer the app stores.
    if (
      !token &&
      req.method === 'GET' &&
      typeof req.query['token'] === 'string'
    ) {
      token = req.query['token'].trim();
    }
    if (!token) throw new UnauthorizedException('Missing token');

    let member = await this.members.findOne({
      where: { token },
      relations: { trip: true },
    });
    if (!member) {
      // A device whose spot an admin merged into an older one.
      const alias = await this.ds
        .getRepository(MemberAlias)
        .findOne({ where: { token } });
      if (alias)
        member = await this.members.findOne({
          where: { id: alias.memberId },
          relations: { trip: true },
        });
    }
    if (!member) throw new UnauthorizedException('Invalid token');

    const tripId = (req.params as Record<string, string>)['tripId'];
    if (tripId && tripId !== member.tripId)
      throw new ForbiddenException('Not a member of this trip');

    req.member = member;
    return true;
  }
}
