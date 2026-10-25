import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Idea, ItineraryEntry, Member } from '../entities';
import { TripsModule } from '../trips/trips.module';
import { ActivityModule } from '../activity/activity.module';
import { ItineraryController } from './itinerary.controller';
import { ItineraryService } from './itinerary.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ItineraryEntry, Idea, Member]),
    TripsModule,
    ActivityModule,
  ],
  controllers: [ItineraryController],
  providers: [ItineraryService],
})
export class ItineraryModule {}
