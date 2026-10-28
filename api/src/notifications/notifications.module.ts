import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Member, Notification, PushSubscription, Trip } from '../entities';
import {
  NotificationsController,
  PushController,
} from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PUSH_SENDER, PushService, WebPushSender } from './push.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, PushSubscription, Member, Trip]),
  ],
  controllers: [NotificationsController, PushController],
  providers: [
    NotificationsService,
    PushService,
    { provide: PUSH_SENDER, useClass: WebPushSender },
  ],
  exports: [NotificationsService, PushService],
})
export class NotificationsModule {}
