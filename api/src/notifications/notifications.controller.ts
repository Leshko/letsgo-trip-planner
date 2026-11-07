import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { MemberGuard } from '../common/member.guard';
import { CurrentMember } from '../common/current-member.decorator';
import { Member } from '../entities';
import {
  MarkReadDto,
  PushSubscribeDto,
  PushUnsubscribeDto,
  NativePushDto,
} from './notifications.dto';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';

@Controller('trips')
@UseGuards(MemberGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly push: PushService,
  ) {}

  @Get(':tripId/notifications')
  list(
    @Param('tripId') tripId: string,
    @CurrentMember() me: Member,
    @Query('limit') limit?: string,
  ) {
    const n = Math.min(Math.max(Number(limit) || 30, 1), 100);
    return this.notifications.list(tripId, me.id, n);
  }

  @Post(':tripId/notifications/read')
  markRead(
    @Param('tripId') tripId: string,
    @CurrentMember() me: Member,
    @Body() dto: MarkReadDto,
  ) {
    return this.notifications.markRead(tripId, me.id, dto.ids);
  }

  /** Register this browser for push. Idempotent per endpoint. */
  @Post('me/push')
  async subscribe(
    @CurrentMember() me: Member,
    @Body() dto: PushSubscribeDto,
    @Req() req: Request,
  ) {
    await this.push.upsert(me, dto, String(req.headers.origin ?? ''));
    return { ok: true };
  }

  /** Register the phone app on this device for push. Idempotent per token. */
  @Post('me/push/native')
  async subscribeNative(
    @CurrentMember() me: Member,
    @Body() dto: NativePushDto,
  ) {
    await this.push.upsertNative(me, dto.platform, dto.token);
    return { ok: true };
  }

  @Delete('me/push')
  @HttpCode(204)
  unsubscribe(@CurrentMember() me: Member, @Body() dto: PushUnsubscribeDto) {
    return this.push.remove(me, dto.endpoint);
  }
}

/** The VAPID public key is public by nature; the client needs it before it can subscribe. */
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('public-key')
  key() {
    return { publicKey: this.push.publicKey };
  }

  /** Which phone apps can get notifications from this server. */
  @Get('native')
  native() {
    return this.push.nativeChannels();
  }
}
