import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { Throttle } from '../common/throttle';
import { clientIp } from '../common/client-ip';
import { User } from '../entities';
import { AccountGuard, CurrentUser } from './account.guard';
import type { AccountRequest } from './account.guard';
import { AccountService } from './account.service';
import { AuthService } from './auth.service';

class EmailStartDto {
  @IsEmail() @MaxLength(254) email!: string;
}

class EmailVerifyDto {
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @Length(6, 12) code?: string;
  @IsOptional() @IsString() @Length(20, 100) token?: string;
}

class ExchangeDto {
  @IsString() @Length(20, 100) code!: string;
}

class ClaimDto {
  @IsString() @Length(10, 200) memberToken!: string;
}

class RenameDto {
  @IsString() @Length(1, 60) name!: string;
}

const ua = (req: Request) => String(req.headers['user-agent'] ?? '');

@Controller('auth')
export class AuthController {
  private readonly emailThrottle = new Throttle(10, 60_000);
  private readonly verifyThrottle = new Throttle(20, 60_000);

  constructor(private readonly auth: AuthService) {}

  /** Which sign-in buttons to show. */
  @Get('providers')
  providers() {
    return this.auth.providers();
  }

  @Get(':provider/start')
  async start(
    @Param('provider') provider: string,
    @Query('returnTo') returnTo: string | undefined,
    @Res() res: Response,
  ) {
    res.redirect(302, await this.auth.startOAuth(provider, returnTo));
  }

  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query() q: { code?: string; state?: string; error?: string },
    @Res() res: Response,
  ) {
    res.redirect(302, await this.auth.finishOAuth(provider, q));
  }

  @Post('exchange')
  @HttpCode(200)
  exchange(@Body() dto: ExchangeDto, @Req() req: Request) {
    this.verifyThrottle.hit(clientIp(req));
    return this.auth.exchange(dto.code, ua(req));
  }

  @Post('email/start')
  @HttpCode(202)
  async emailStart(@Body() dto: EmailStartDto, @Req() req: Request) {
    this.emailThrottle.hit(clientIp(req));
    await this.auth.startEmail(dto.email);
    return { sent: true };
  }

  @Post('email/verify')
  @HttpCode(200)
  emailVerify(@Body() dto: EmailVerifyDto, @Req() req: Request) {
    this.verifyThrottle.hit(clientIp(req));
    return this.auth.verifyEmail(dto, ua(req));
  }
}

@Controller('account')
@UseGuards(AccountGuard)
export class AccountController {
  constructor(
    private readonly auth: AuthService,
    private readonly account: AccountService,
  ) {}

  @Get()
  async me(@CurrentUser() user: User) {
    return {
      user: await this.auth.view(user),
      trips: await this.account.myTrips(user),
    };
  }

  @Patch()
  rename(@CurrentUser() user: User, @Body() dto: RenameDto) {
    return this.auth.rename(user, dto.name);
  }

  /** Save a trip spot this device already has to the signed-in account. */
  @Post('claim')
  @HttpCode(200)
  claim(@CurrentUser() user: User, @Body() dto: ClaimDto) {
    return this.account.claim(user, dto.memberToken);
  }

  @Post('signout')
  @HttpCode(204)
  async signOut(@Req() req: AccountRequest) {
    await this.auth.signOut(req.accountToken ?? '');
  }

  /** Removes the account and every sign-in. Trip spots stay, without an account. */
  @Delete()
  @HttpCode(204)
  async remove(@CurrentUser() user: User) {
    await this.auth.deleteUser(user.id);
  }
}
