import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { Member } from '../entities';

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
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new UnauthorizedException('Missing token');

    const member = await this.members.findOne({
      where: { token },
      relations: { trip: true },
    });
    if (!member) throw new UnauthorizedException('Invalid token');

    const tripId = (req.params as Record<string, string>)['tripId'];
    if (tripId && tripId !== member.tripId)
      throw new ForbiddenException('Not a member of this trip');

    req.member = member;
    return true;
  }
}
