import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { SELFIE_DIFFICULTIES } from '../entities';
import type { SelfieDifficulty } from '../entities';
import { HINT_MAX, TITLE_MAX } from './selfie.ai';

export class GameStateDto {
  @IsBoolean() on!: boolean;
}

export class AddChallengeDto {
  @IsString() @Length(4, TITLE_MAX) title!: string;
  @IsOptional() @IsString() @MaxLength(HINT_MAX) hint?: string;
  @IsIn(SELFIE_DIFFICULTIES) difficulty!: SelfieDifficulty;
}

export class EditChallengeDto {
  @IsOptional() @IsString() @Length(4, TITLE_MAX) title?: string;
  @IsOptional() @IsString() @MaxLength(HINT_MAX) hint?: string;
  @IsOptional() @IsIn(SELFIE_DIFFICULTIES) difficulty?: SelfieDifficulty;
}

export class OverruleDto {
  @IsIn(['approved', 'rejected']) status!: 'approved' | 'rejected';
}
