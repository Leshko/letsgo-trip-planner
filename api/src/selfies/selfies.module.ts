import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Member } from '../entities';
import { ActivityModule } from '../activity/activity.module';
import { AiModule } from '../ai/ai.module';
import { PhotosModule } from '../photos/photos.module';
import { SelfiesController } from './selfies.controller';
import { SelfiesService } from './selfies.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Member]),
    ActivityModule,
    AiModule,
    PhotosModule,
  ],
  controllers: [SelfiesController],
  providers: [SelfiesService],
})
export class SelfiesModule {}
