import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateTripDto {
  @IsString() @Length(1, 80) name!: string;
  @IsOptional() @IsString() @MaxLength(120) destination?: string;
  @IsString() @Matches(ISO_DATE) startDate!: string;
  @IsString() @Matches(ISO_DATE) endDate!: string;
  @IsString() @Length(1, 40) memberName!: string;
  @IsOptional() @IsString() @MaxLength(8) emoji?: string;
}

export class JoinTripDto {
  @IsString() @Length(4, 12) code!: string;
  @IsString() @Length(1, 40) name!: string;
  @IsOptional() @IsString() @MaxLength(8) emoji?: string;
}

export class UpdateProfileDto {
  @IsOptional() @IsString() @Length(1, 40) name?: string;
  @IsOptional() @IsString() @MaxLength(8) emoji?: string;
}

export class UpdateTripDto {
  @IsOptional() @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsString() @MaxLength(120) destination?: string;
  @IsOptional() @IsString() @Matches(ISO_DATE) startDate?: string;
  @IsOptional() @IsString() @Matches(ISO_DATE) endDate?: string;
}

export class LodgingDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(60) checkIn?: string;
  @IsOptional() @IsString() @MaxLength(60) checkOut?: string;
  @IsOptional() @IsString() @MaxLength(500) link?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  photos?: string[];
}
