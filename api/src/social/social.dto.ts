import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const POLL_MAX_OPTIONS = 10;
export const POLL_OPTION_MAX = 80;

export class PollInputDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(POLL_MAX_OPTIONS)
  @IsString({ each: true })
  @MaxLength(POLL_OPTION_MAX, { each: true })
  options!: string[];

  /** People may pick more than one option. */
  @IsOptional() @IsBoolean() multiple?: boolean;
}

export class CreatePostDto {
  /** The message, or the question when the post is a poll. */
  @IsString() @Length(1, 2000) body!: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PollInputDto)
  poll?: PollInputDto;
}

export class PollVoteDto {
  @IsString() @Length(1, 40) optionId!: string;
}

export class PollCloseDto {
  @IsBoolean() closed!: boolean;
}

export class ReactDto {
  /** A single emoji (or short grapheme cluster). */
  @IsString() @Length(1, 8) emoji!: string;
}

export class CreateCommentDto {
  @IsString() @Length(1, 1000) body!: string;
}
