import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Activity, Member } from '../entities';
import { ActivityService } from './activity.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TypeOrmModule.forFeature([Activity, Member]), NotificationsModule],
  providers: [ActivityService],
  exports: [ActivityService, TypeOrmModule],
})
export class ActivityModule {}
