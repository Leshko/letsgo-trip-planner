import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Member, TransferCode, Trip } from '../entities';
import { AvatarsController, TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trip, Member, TransferCode]),
    ActivityModule,
    AuthModule,
  ],
  controllers: [TripsController, AvatarsController],
  providers: [TripsService],
  exports: [TripsService],
})
export class TripsModule {}
