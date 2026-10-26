import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import archiver from 'archiver';
import { diskStorage } from 'multer';
import { MemberGuard } from '../common/member.guard';
import { CurrentMember } from '../common/current-member.decorator';
import { Member } from '../entities';
import { photosTmpDir } from '../common/paths';
import { ALLOWED_MIMES } from './image-type';
import {
  CreatePhotoCommentDto,
  UpdatePhotoDto,
  UploadPhotoDto,
} from './photos.dto';
import { PhotosService, UploadedFiles as Files } from './photos.service';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const VARIANTS = new Set(['original', 'thumb', 'preview']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('trips/:tripId')
@UseGuards(MemberGuard)
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Get('photos')
  list(@Param('tripId') tripId: string) {
    return this.photos.list(tripId);
  }

  @Post('photos')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'original', maxCount: 1 },
        { name: 'thumb', maxCount: 1 },
        { name: 'preview', maxCount: 1 },
      ],
      {
        storage: diskStorage({
          destination: (_req, _file, cb) => cb(null, photosTmpDir()),
        }),
        limits: { fileSize: MAX_FILE_BYTES, files: 3, fields: 8 },
        fileFilter: (_req, file, cb) => {
          // Cheap first gate on the browser's claim; the bytes are sniffed afterwards.
          if (
            ALLOWED_MIMES.has(file.mimetype) ||
            file.mimetype === 'application/octet-stream'
          )
            cb(null, true);
          else
            cb(
              new BadRequestException(
                `${file.mimetype} is not a supported image type`,
              ),
              false,
            );
        },
      },
    ),
  )
  upload(
    @Param('tripId') tripId: string,
    @CurrentMember() me: Member,
    @UploadedFiles() files: Files | undefined,
    @Body() dto: UploadPhotoDto,
  ) {
    return this.photos.upload(tripId, me, files, dto);
  }

  /** Streams every original as one zip. Needs ?token= because it is opened as a plain link. */
  @Get('photos.zip')
  async zip(@Param('tripId') tripId: string, @Res() res: Response) {
    const entries = await this.photos.zipEntries(tripId);
    if (!entries.length) throw new NotFoundException('No photos yet');
    res.attachment(await this.photos.zipName(tripId));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Cache-Control', 'no-store');

    const archive = archiver('zip', { store: true });
    archive.on('warning', (err: Error & { code?: string }) => {
      if (err.code !== 'ENOENT') res.destroy(err);
    });
    archive.on('error', (err: Error) => res.destroy(err));
    res.on('close', () => {
      if (!res.writableFinished) archive.abort();
    });
    archive.pipe(res);
    for (const e of entries) archive.file(e.path, { name: e.name });
    await archive.finalize();
  }

  @Patch('photos/:photoId')
  caption(
    @Param('tripId') tripId: string,
    @Param('photoId') photoId: string,
    @CurrentMember() me: Member,
    @Body() dto: UpdatePhotoDto,
  ) {
    return this.photos.updateCaption(tripId, me, photoId, dto.caption);
  }

  @Delete('photos/:photoId')
  @HttpCode(204)
  remove(
    @Param('tripId') tripId: string,
    @Param('photoId') photoId: string,
    @CurrentMember() me: Member,
  ) {
    return this.photos.remove(tripId, me, photoId);
  }

  @Get('photos/:photoId/comments')
  comments(@Param('tripId') tripId: string, @Param('photoId') photoId: string) {
    return this.photos.listComments(tripId, photoId);
  }

  @Post('photos/:photoId/comments')
  addComment(
    @Param('tripId') tripId: string,
    @Param('photoId') photoId: string,
    @CurrentMember() me: Member,
    @Body() dto: CreatePhotoCommentDto,
  ) {
    return this.photos.addComment(tripId, me, photoId, dto);
  }

  @Delete('photo-comments/:commentId')
  @HttpCode(204)
  deleteComment(
    @Param('tripId') tripId: string,
    @Param('commentId') commentId: string,
    @CurrentMember() me: Member,
  ) {
    return this.photos.deleteComment(tripId, me, commentId);
  }
}

/** Photo bytes are fetched by <img> and <a download>, which can't send a bearer token. */
@Controller('photo-files')
export class PhotoFilesController {
  constructor(private readonly photos: PhotosService) {}

  @Get(':photoId/:variant')
  async file(
    @Param('photoId') photoId: string,
    @Param('variant') variant: string,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ) {
    if (!UUID.test(photoId) || !VARIANTS.has(variant))
      throw new NotFoundException();
    const f = await this.photos.filePath(
      photoId,
      variant as 'original' | 'thumb' | 'preview',
    );
    if (!f) throw new NotFoundException();
    const headers = {
      'Content-Type': f.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
    };
    if (download) {
      res.download(f.path, f.name, { headers }, (err) => {
        if (err && !res.headersSent) res.status(404).end();
      });
      return;
    }
    res.sendFile(f.path, { headers }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }
}
