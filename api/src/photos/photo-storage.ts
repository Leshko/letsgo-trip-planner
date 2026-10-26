import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { mkdir, readdir, rename, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { photosDir, photosTmpDir } from '../common/paths';
import type { Photo } from '../entities';

export type Variant = 'original' | 'thumb' | 'preview';

/** Files on disk for a photo: the original plus optional JPEG derivatives. */
@Injectable()
export class PhotoStorage implements OnModuleInit {
  private readonly log = new Logger(PhotoStorage.name);

  onModuleInit() {
    void this.sweepTmp();
    setInterval(() => void this.sweepTmp(), 30 * 60_000).unref();
  }

  pathFor(
    photo: Pick<Photo, 'id' | 'tripId' | 'ext'>,
    variant: Variant,
  ): string {
    const base = join(photosDir(), photo.tripId);
    if (variant === 'original') return join(base, `${photo.id}.${photo.ext}`);
    return join(base, `${photo.id}-${variant}.jpg`);
  }

  /** Move a staged upload into its final place. Same filesystem, so this is atomic. */
  async commit(
    stagedPath: string,
    photo: Pick<Photo, 'id' | 'tripId' | 'ext'>,
    variant: Variant,
  ): Promise<void> {
    await mkdir(join(photosDir(), photo.tripId), { recursive: true });
    await rename(stagedPath, this.pathFor(photo, variant));
  }

  async remove(photo: Pick<Photo, 'id' | 'tripId' | 'ext'>): Promise<void> {
    for (const v of ['original', 'thumb', 'preview'] as Variant[])
      await this.unlinkQuiet(this.pathFor(photo, v));
  }

  async unlinkQuiet(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
        this.log.warn(`Could not delete ${path}: ${String(e)}`);
    }
  }

  /** Uploads that never completed (validation failed, client vanished) are cleaned up after an hour. */
  async sweepTmp(): Promise<void> {
    const dir = photosTmpDir();
    const cutoff = Date.now() - 60 * 60_000;
    try {
      for (const name of await readdir(dir)) {
        const p = join(dir, name);
        const s = await stat(p).catch(() => null);
        if (s?.isFile() && s.mtimeMs < cutoff) await this.unlinkQuiet(p);
      }
    } catch (e) {
      this.log.warn(`tmp sweep failed: ${String(e)}`);
    }
  }
}
