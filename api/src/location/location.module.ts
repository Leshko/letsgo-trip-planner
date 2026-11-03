import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Member, MemberLocation } from '../entities';
import { LocationController } from './location.controller';
import { LocationService } from './location.service';

@Module({
  imports: [TypeOrmModule.forFeature([Member, MemberLocation])],
  controllers: [LocationController],
  providers: [LocationService],
  exports: [LocationService],
})
export class LocationModule {}
