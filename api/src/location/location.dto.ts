import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class SharingDto {
  @IsBoolean() on!: boolean;
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
}
