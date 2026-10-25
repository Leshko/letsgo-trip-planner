import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateEntryDto {
  @IsString() @Matches(ISO_DATE) date!: string;
  @IsOptional() @IsString() @Matches(TIME) startTime?: string;
  @IsOptional() @IsString() @Length(1, 120) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsUUID() ideaId?: string;
}

export class UpdateEntryDto {
  @IsOptional() @IsString() @Matches(ISO_DATE) date?: string;
  @IsOptional()
  @IsString()
  @Matches(/^(([01]\d|2[0-3]):[0-5]\d)?$/)
  startTime?: string;
  @IsOptional() @IsString() @Length(1, 120) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class ReorderDto {
  @IsString() @Matches(ISO_DATE) date!: string;
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  entryIds!: string[];
}
