import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

class MergeDto {
  /** The duplicate (usually the newer spot made when someone rejoined). */
  @IsUUID() fromMemberId!: string;
  /** The original spot to keep. */
  @IsUUID() intoMemberId!: string;
}

class LinkAccountDto {
  @IsEmail() @MaxLength(254) email!: string;
  /** Move the spot off the account it's on now. */
  @IsOptional() @IsBoolean() replace?: boolean;
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

  /** Save a person's spot to the account for an email address. */
  @Post('trips/:tripId/members/:memberId/account')
  @HttpCode(200)
  link(
    @Param('tripId') tripId: string,
    @Param('memberId') memberId: string,
    @Body() dto: LinkAccountDto,
  ) {
    return this.admin.linkAccount(tripId, memberId, dto.email, dto.replace);
  }

  @Delete('trips/:tripId/members/:memberId/account')
  unlink(@Param('tripId') tripId: string, @Param('memberId') memberId: string) {
    return this.admin.unlinkAccount(tripId, memberId);
  }
}
