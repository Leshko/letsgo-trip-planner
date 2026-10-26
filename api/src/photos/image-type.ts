import { open } from 'fs/promises';
import type { PhotoExt } from '../entities';

export interface ImageType {
  ext: PhotoExt;
  mime: string;
}

export const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

/** Identify an image by its first bytes, ignoring whatever the browser claimed. */
export async function sniffImageType(path: string): Promise<ImageType | null> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await fh.read(buf, 0, 16, 0);
    if (bytesRead < 12) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
      return { ext: 'jpg', mime: 'image/jpeg' };
    if (buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])))
      return { ext: 'png', mime: 'image/png' };
    if (buf.subarray(0, 4).toString('ascii') === 'GIF8')
      return { ext: 'gif', mime: 'image/gif' };
    if (
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return { ext: 'webp', mime: 'image/webp' };
    }
    if (buf.subarray(4, 8).toString('ascii') === 'ftyp') {
      const brand = buf.subarray(8, 12).toString('ascii').toLowerCase();
      if (['heic', 'heix', 'hevc', 'hevx'].includes(brand))
        return { ext: 'heic', mime: 'image/heic' };
      if (['mif1', 'msf1', 'heif'].includes(brand))
        return { ext: 'heif', mime: 'image/heif' };
    }
    return null;
  } finally {
    await fh.close();
  }
}
