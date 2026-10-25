import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Activity, Member } from '../entities';
import { ActivityService } from './activity.service';

@Module({
  imports: [TypeOrmModule.forFeature([Activity, Member])],
  providers: [ActivityService],
  exports: [ActivityService, TypeOrmModule],
})
export class ActivityModule {}
