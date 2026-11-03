import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  Validate,
} from 'class-validator';

/** A real IANA time zone such as America/Los_Angeles. */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

@ValidatorConstraint({ name: 'timeZone' })
class TimeZoneConstraint implements ValidatorConstraintInterface {
  validate(v: unknown) {
    return isTimeZone(v);
  }
  defaultMessage(a: ValidationArguments) {
    return `${a.property} must be a time zone like America/Los_Angeles`;
  }
}

export class SharingDto {
  @IsBoolean() on!: boolean;

  /** The phone's time zone; the trip ends at midnight there. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Validate(TimeZoneConstraint)
  timeZone?: string;
}

export class LocationDto {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100_000)
  accuracy?: number;

  /** The phone's time zone; the trip ends at midnight there. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Validate(TimeZoneConstraint)
  timeZone?: string;
}
