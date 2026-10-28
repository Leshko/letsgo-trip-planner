import { Controller, Get } from '@nestjs/common';
import { AiService } from './ai.service';

/** Lets the UI know whether link summaries are on. No secrets, no guard. */
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('status')
  status() {
    const c = this.ai.config();
    return { enabled: c.enabled, model: c.model };
  }
}
