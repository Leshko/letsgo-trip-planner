import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { MemberGuard } from '../common/member.guard';
import { CurrentMember } from '../common/current-member.decorator';
import { Member } from '../entities';
import { memberView } from '../common/serializers';
import {
  CreateTripDto,
  JoinTripDto,
  LodgingDto,
  UpdateProfileDto,
  UpdateTripDto,
} from './trips.dto';
import { TripsService } from './trips.service';

@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Post()
  create(@Body() dto: CreateTripDto) {
    return this.trips.create(dto);
  }

  @Post('join')
  join(@Body() dto: JoinTripDto) {
    return this.trips.join(dto);
  }

  /** Resolve the caller's token into their member + trip (used on app load). */
  @Get('me')
  @UseGuards(MemberGuard)
  async me(@CurrentMember() me: Member) {
    return {
      member: memberView(me),
      trip: await this.trips.getView(me.tripId),
    };
  }

  @Patch('me')
  @UseGuards(MemberGuard)
  profile(@CurrentMember() me: Member, @Body() dto: UpdateProfileDto) {
    return this.trips.updateProfile(me, dto);
  }

  @Get(':tripId')
  @UseGuards(MemberGuard)
  get(@Param('tripId') tripId: string) {
    return this.trips.getView(tripId);
  }

  @Patch(':tripId')
  @UseGuards(MemberGuard)
  update(
    @Param('tripId') tripId: string,
    @CurrentMember() me: Member,
    @Body() dto: UpdateTripDto,
  ) {
    return this.trips.update(tripId, me, dto);
  }

  @Put(':tripId/lodging')
  @UseGuards(MemberGuard)
  lodging(
    @Param('tripId') tripId: string,
    @CurrentMember() me: Member,
    @Body() dto: LodgingDto,
  ) {
    return this.trips.updateLodging(tripId, me, dto);
  }
}
