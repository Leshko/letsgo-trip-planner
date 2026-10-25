import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { MemberGuard } from '../common/member.guard';
import { UnfurlService } from './unfurl.service';

@Controller('trips/:tripId/unfurl')
@UseGuards(MemberGuard)
export class UnfurlController {
  constructor(private readonly unfurl: UnfurlService) {}

  /** Link preview for the add-idea form. Members only, so it can't be used as an open proxy. */
  @Get()
  get(@Query('url') url: string) {
    return this.unfurl.unfurl(url ?? '');
  }
}
