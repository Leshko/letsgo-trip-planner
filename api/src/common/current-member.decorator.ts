import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthedRequest } from './member.guard';

export const CurrentMember = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    return ctx.switchToHttp().getRequest<AuthedRequest>().member;
  },
);
