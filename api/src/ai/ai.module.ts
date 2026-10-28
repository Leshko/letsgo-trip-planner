import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UnfurlCache } from '../entities';
import { AI_CLIENT, AnthropicAiClient, FakeAiClient } from './ai.client';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [TypeOrmModule.forFeature([UnfurlCache])],
  controllers: [AiController],
  providers: [
    AiService,
    {
      provide: AI_CLIENT,
      useFactory: () =>
        process.env.AI_FAKE === '1'
          ? new FakeAiClient()
          : new AnthropicAiClient(),
    },
  ],
  exports: [AiService],
})
export class AiModule {}
