import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Member, Photo, PhotoComment, Trip } from '../entities';
import { ActivityModule } from '../activity/activity.module';
import { PhotoFilesController, PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';
import { PhotoStorage } from './photo-storage';

@Module({
  imports: [
    TypeOrmModule.forFeature([Photo, PhotoComment, Trip, Member]),
    ActivityModule,
  ],
  controllers: [PhotosController, PhotoFilesController],
  providers: [PhotosService, PhotoStorage],
})
export class PhotosModule {}
