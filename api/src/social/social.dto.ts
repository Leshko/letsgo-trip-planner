import { IsString, Length } from 'class-validator';

export class CreatePostDto {
  @IsString() @Length(1, 2000) body!: string;
}

export class ReactDto {
  /** A single emoji (or short grapheme cluster). */
  @IsString() @Length(1, 8) emoji!: string;
}

export class CreateCommentDto {
  @IsString() @Length(1, 1000) body!: string;
}
