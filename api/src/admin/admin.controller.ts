import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

class MergeDto {
  /** The duplicate (usually the newer spot made when someone rejoined). */
  @IsUUID() fromMemberId!: string;
  /** The original spot to keep. */
  @IsUUID() intoMemberId!: string;
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('check')
  check() {
    return { ok: true };
  }

  @Get('trips')
  trips() {
    return this.admin.trips();
  }

  @Get('trips/:tripId')
  trip(@Param('tripId') tripId: string) {
    return this.admin.tripById(tripId);
  }

  @Post('trips/:tripId/merge')
  @HttpCode(200)
  merge(@Param('tripId') tripId: string, @Body() dto: MergeDto) {
    return this.admin.merge(tripId, dto.fromMemberId, dto.intoMemberId);
  }
}
