import { Controller, Get } from '@nestjs/common';
import { publicUrl } from './auth/auth.config';

/** What the app needs to know before anything else, e.g. its main web address. */
@Controller('config')
export class ConfigController {
  @Get()
  config() {
    return { publicUrl: publicUrl() };
  }
}
