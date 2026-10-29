import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AccountSession,
  AuthFlow,
  AuthHandoff,
  EmailCode,
  Identity,
  Member,
  Trip,
  User,
} from '../entities';
import { AccountGuard, OptionalAccountGuard } from './account.guard';
import { AccountService } from './account.service';
import { AccountController, AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MailService } from './mail.service';
import { OidcService } from './oidc.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Identity,
      AccountSession,
      EmailCode,
      AuthFlow,
      AuthHandoff,
      Member,
      Trip,
    ]),
  ],
  controllers: [AuthController, AccountController],
  providers: [
    AuthService,
    AccountService,
    MailService,
    OidcService,
    AccountGuard,
    OptionalAccountGuard,
  ],
  exports: [AuthService, AccountService, AccountGuard, OptionalAccountGuard],
})
export class AuthModule {}
