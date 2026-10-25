import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Member } from '../entities';
import { UnfurlController } from './unfurl.controller';
import { UnfurlService } from './unfurl.service';

@Module({
  imports: [TypeOrmModule.forFeature([Member])],
  controllers: [UnfurlController],
  providers: [UnfurlService],
})
export class UnfurlModule {}
