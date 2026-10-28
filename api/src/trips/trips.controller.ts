import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  Delete,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { MemberGuard } from '../common/member.guard';
import { CurrentMember } from '../common/current-member.decorator';
import { Member } from '../entities';
import { memberView } from '../common/serializers';
import {
  CreateTripDto,
  JoinTripDto,
  AvatarDto,
  LodgingDto,
  TransferDto,
  UpdateProfileDto,
  UpdateTripDto,
} from './trips.dto';
import { Throttle } from '../common/throttle';
import { effectivePrefs } from '../common/notify-prefs';
import { NotifyPrefsDto } from '../notifications/notifications.dto';
import { TripsService } from './trips.service';

@Controller('trips')
export class TripsController {
  private readonly throttle = new Throttle(10, 60_000);

  constructor(private readonly trips: TripsService) {}

  @Post()
  create(@Body() dto: CreateTripDto) {
    return this.trips.create(dto);
  }

  @Post('join')
  join(@Body() dto: JoinTripDto) {
    return this.trips.join(dto);
  }

  /** Sign in on this device with a login code made on another one. */
  @Post('transfer')
  transfer(@Body() dto: TransferDto, @Req() req: Request) {
    this.throttle.hit(req.ip ?? 'unknown');
    return this.trips.redeemTransferCode(dto);
  }

  @Post('me/transfer-code')
  @UseGuards(MemberGuard)
  transferCode(@CurrentMember() me: Member) {
    return this.trips.createTransferCode(me);
  }

  /** Resolve the caller's token into their member + trip (used on app load). */
  @Get('me')
  @UseGuards(MemberGuard)
  async me(@CurrentMember() me: Member) {
    return {
      member: memberView(me),
      trip: await this.trips.getView(me.tripId),
      notifyPrefs: effectivePrefs(me),
    };
  }

  @Patch('me')
  @UseGuards(MemberGuard)
  profile(@CurrentMember() me: Member, @Body() dto: UpdateProfileDto) {
    return this.trips.updateProfile(me, dto);
  }

  @Patch('me/notify-prefs')
  @UseGuards(MemberGuard)
  notifyPrefs(@CurrentMember() me: Member, @Body() dto: NotifyPrefsDto) {
    return this.trips.updateNotifyPrefs(me, dto);
  }

  @Put('me/avatar')
  @UseGuards(MemberGuard)
  setAvatar(@CurrentMember() me: Member, @Body() dto: AvatarDto) {
    return this.trips.setAvatar(me, dto);
  }

  @Delete('me/avatar')
  @UseGuards(MemberGuard)
  clearAvatar(@CurrentMember() me: Member) {
    return this.trips.setAvatar(me, null);
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

/** Photos are fetched by <img>, which can't send a bearer token; the member id is an unguessable UUID. */
@Controller('avatars')
export class AvatarsController {
  constructor(private readonly trips: TripsService) {}

  @Get(':memberId')
  async get(@Param('memberId') memberId: string, @Res() res: Response) {
    const a = await this.trips.getAvatar(memberId);
    if (!a) throw new NotFoundException();
    res.setHeader('Content-Type', a.type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(a.bytes);
  }
}
