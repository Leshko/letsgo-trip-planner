import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { COST_LEVELS, IDEA_KINDS } from '../entities';
import type { CostLevel, IdeaKind } from '../entities';

export class IdeaDetailDto {
  @IsString() @Length(1, 40) label!: string;
  @IsString() @Length(1, 300) value!: string;
}

export class CreateIdeaDto {
  @IsIn(IDEA_KINDS) kind!: IdeaKind;
  @IsString() @Length(1, 120) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(500) link?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsIn(COST_LEVELS) cost?: CostLevel;
  @IsOptional() @IsString() @MaxLength(1000) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(120) siteName?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => IdeaDetailDto)
  details?: IdeaDetailDto[];
}

export class UpdateIdeaDto {
  @IsOptional() @IsString() @Length(1, 120) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(500) link?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsIn(COST_LEVELS) cost?: CostLevel;
  @IsOptional() @IsString() @MaxLength(1000) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(120) siteName?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => IdeaDetailDto)
  details?: IdeaDetailDto[];
}
