import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { MemberGuard } from '../common/member.guard';
import { UnfurlService } from './unfurl.service';

@Controller('trips/:tripId/unfurl')
@UseGuards(MemberGuard)
export class UnfurlController {
  constructor(private readonly unfurl: UnfurlService) {}

  /** Link preview for the add-idea form. Members only, so it can't be used as an open proxy. */
  @Get()
  get(
    @Param('tripId') tripId: string,
    @Query('url') url: string,
    @Query('fresh') fresh?: string,
  ) {
    return this.unfurl.unfurl(url ?? '', tripId, fresh === '1');
  }
}
