import { Module } from '@nestjs/common';
import { LegacyImportService } from './legacy-import.service';

@Module({
  providers: [LegacyImportService],
  exports: [LegacyImportService],
})
export class LegacyImportModule {}
