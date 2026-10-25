import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { MemberGuard } from '../common/member.guard';
import { CurrentMember } from '../common/current-member.decorator';
import { Member } from '../entities';
import { CreateEntryDto, ReorderDto, UpdateEntryDto } from './itinerary.dto';
import { ItineraryService } from './itinerary.service';

@Controller('trips/:tripId/itinerary')
@UseGuards(MemberGuard)
export class ItineraryController {
  constructor(private readonly itinerary: ItineraryService) {}

  @Get()
  list(@Param('tripId') tripId: string) {
    return this.itinerary.list(tripId);
  }

  @Post()
  create(
    @Param('tripId') tripId: string,
    @CurrentMember() me: Member,
    @Body() dto: CreateEntryDto,
  ) {
    return this.itinerary.create(tripId, me, dto);
  }

  @Put('reorder')
  reorder(@Param('tripId') tripId: string, @Body() dto: ReorderDto) {
    return this.itinerary.reorder(tripId, dto);
  }

  @Patch(':entryId')
  update(
    @Param('tripId') tripId: string,
    @Param('entryId') entryId: string,
    @Body() dto: UpdateEntryDto,
  ) {
    return this.itinerary.update(tripId, entryId, dto);
  }

  @Delete(':entryId')
  @HttpCode(204)
  remove(@Param('tripId') tripId: string, @Param('entryId') entryId: string) {
    return this.itinerary.remove(tripId, entryId);
  }
}
