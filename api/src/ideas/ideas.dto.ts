import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { COST_LEVELS, IDEA_KINDS } from '../entities';
import type { CostLevel, IdeaKind } from '../entities';

export class CreateIdeaDto {
  @IsIn(IDEA_KINDS) kind!: IdeaKind;
  @IsString() @Length(1, 120) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(500) link?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsIn(COST_LEVELS) cost?: CostLevel;
}

export class UpdateIdeaDto {
  @IsOptional() @IsString() @Length(1, 120) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(500) link?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsIn(COST_LEVELS) cost?: CostLevel;
}
