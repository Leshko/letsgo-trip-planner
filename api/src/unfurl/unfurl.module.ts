import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Member } from '../entities';
import { UnfurlController } from './unfurl.controller';
import { UnfurlService } from './unfurl.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [TypeOrmModule.forFeature([Member]), AiModule],
  controllers: [UnfurlController],
  providers: [UnfurlService],
})
export class UnfurlModule {}
