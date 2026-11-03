import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { MemberGuard } from '../common/member.guard';
import { CurrentMember } from '../common/current-member.decorator';
import { Member } from '../entities';
import { LocationDto, SharingDto } from './location.dto';
import { LocationService } from './location.service';

@Controller('trips/:tripId')
@UseGuards(MemberGuard)
export class LocationController {
  constructor(private readonly location: LocationService) {}

  @Put('me/location-sharing')
  sharing(@CurrentMember() me: Member, @Body() dto: SharingDto) {
    return this.location.setSharing(me, dto.on);
  }

  @Put('me/location')
  update(@CurrentMember() me: Member, @Body() dto: LocationDto) {
    return this.location.update(me, dto.lat, dto.lng, dto.accuracy);
  }

  @Get('locations')
  list(@CurrentMember() me: Member) {
    return this.location.list(me.trip);
  }
}
