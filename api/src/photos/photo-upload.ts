import { BadRequestException, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { photosTmpDir } from '../common/paths';
import { ALLOWED_MIMES } from './image-type';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Accepts one photo upload: the original plus the small JPEGs the phone made
 * of it (thumb, preview). Staged in a temp folder; the service checks the bytes.
 */
export const PhotoUpload = () =>
  UseInterceptors(
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
  );
