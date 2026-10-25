import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment, Idea, Member, Vote } from '../entities';
import { ActivityModule } from '../activity/activity.module';
import { IdeasController } from './ideas.controller';
import { IdeasService } from './ideas.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Idea, Vote, Member, Comment]),
    ActivityModule,
  ],
  controllers: [IdeasController],
  providers: [IdeasService],
})
export class IdeasModule {}
