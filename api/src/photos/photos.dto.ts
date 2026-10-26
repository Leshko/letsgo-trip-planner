import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Multipart text fields arrive as strings, hence the @Type conversions. */
export class UploadPhotoDto {
  @IsString() @Length(8, 64) batchId!: string;
  @IsOptional() @IsString() @MaxLength(500) caption?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20000) width?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20000)
  height?: number;
}

export class UpdatePhotoDto {
  @IsString() @MaxLength(500) caption!: string;
}

export class CreatePhotoCommentDto {
  @IsString() @Length(1, 1000) body!: string;
}
