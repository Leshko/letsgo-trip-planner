import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PushKeysDto {
  @IsString() @MaxLength(300) p256dh!: string;
  @IsString() @MaxLength(100) auth!: string;
}

export class PushSubscribeDto {
  @IsUrl({ require_tld: false }) @MaxLength(1000) endpoint!: string;
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
  @IsOptional() @IsString() @MaxLength(300) userAgent?: string;
}

export class PushUnsubscribeDto {
  @IsString() @MaxLength(1000) endpoint!: string;
}

export class MarkReadDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids?: string[];
}

export class NotifyPrefsDto {
  @IsOptional() @IsBoolean() ideas?: boolean;
  @IsOptional() @IsBoolean() votes?: boolean;
  @IsOptional() @IsBoolean() comments?: boolean;
  @IsOptional() @IsBoolean() wall?: boolean;
  @IsOptional() @IsBoolean() plan?: boolean;
  @IsOptional() @IsBoolean() photos?: boolean;
  @IsOptional() @IsBoolean() members?: boolean;
}
