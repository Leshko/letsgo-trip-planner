import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { stat } from 'fs/promises';
import { Member, Photo, PhotoComment, Trip } from '../entities';
import {
  photoCommentView,
  PhotoCommentView,
  photoView,
  PhotoView,
} from '../common/serializers';
import { ActivityService } from '../activity/activity.service';
import { PhotoStorage } from './photo-storage';
import { sniffImageType } from './image-type';
import { CreatePhotoCommentDto, UploadPhotoDto } from './photos.dto';

export type UploadedFiles = Record<
  'original' | 'thumb' | 'preview',
  Express.Multer.File[] | undefined
>;

const DERIVATIVE_MAX_BYTES = 2_500_000;

export interface ZipEntry {
  path: string;
  name: string;
}

@Injectable()
export class PhotosService {
  constructor(
    @InjectRepository(Photo) private readonly photos: Repository<Photo>,
    @InjectRepository(PhotoComment)
    private readonly comments: Repository<PhotoComment>,
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
    private readonly storage: PhotoStorage,
    private readonly activity: ActivityService,
  ) {}

  async list(tripId: string): Promise<PhotoView[]> {
    const [rows, counts] = await Promise.all([
      this.photos.find({ where: { tripId }, order: { createdAt: 'DESC' } }),
      this.commentCounts(tripId),
    ]);
    return rows.map((p) => photoView(p, counts.get(p.id) ?? 0));
  }

  private async load(tripId: string, id: string): Promise<Photo> {
    const p = await this.photos.findOne({ where: { id, tripId } });
    if (!p) throw new NotFoundException('Photo not found');
    return p;
  }

  /** Validate the staged multipart files, then move them into place and record the row. */
  async upload(
    tripId: string,
    me: Member,
    files: UploadedFiles | undefined,
    dto: UploadPhotoDto,
  ): Promise<PhotoView> {
    const original = files?.original?.[0];
    const thumb = files?.thumb?.[0];
    const preview = files?.preview?.[0];
    const staged = [original, thumb, preview].filter(
      (f): f is Express.Multer.File => !!f,
    );
    try {
      if (!original) throw new BadRequestException('No photo was sent');
      const type = await sniffImageType(original.path);
      if (!type)
        throw new BadRequestException(
          "That file isn't a photo we can store (JPEG, PNG, WebP, GIF or HEIC)",
        );
      for (const d of [thumb, preview]) {
        if (!d) continue;
        const t = await sniffImageType(d.path);
        if (t?.ext !== 'jpg' || d.size > DERIVATIVE_MAX_BYTES)
          throw new BadRequestException('Preview images must be small JPEGs');
      }
      const bytes = (await stat(original.path)).size;
      const photo = await this.photos.save(
        this.photos.create({
          tripId,
          memberId: me.id,
          batchId: dto.batchId,
          caption: (dto.caption ?? '').trim(),
          originalName: safeName(original.originalname) || `photo.${type.ext}`,
          mimeType: type.mime,
          ext: type.ext,
          bytes,
          width: dto.width ?? null,
          height: dto.height ?? null,
          hasThumb: !!thumb,
          hasPreview: !!preview,
        }),
      );
      try {
        await this.storage.commit(original.path, photo, 'original');
        if (thumb) await this.storage.commit(thumb.path, photo, 'thumb');
        if (preview) await this.storage.commit(preview.path, photo, 'preview');
      } catch (e) {
        await this.photos.remove(photo);
        await this.storage.remove(photo);
        throw e;
      }
      const inBatch = await this.photos.count({
        where: { tripId, batchId: dto.batchId, memberId: me.id },
      });
      await this.activity.recordBatch(me, dto.batchId, inBatch);
      return photoView(await this.load(tripId, photo.id));
    } finally {
      // Anything still sitting in tmp (validation failed, commit failed) goes away now.
      for (const f of staged) await this.storage.unlinkQuiet(f.path);
    }
  }

  private canManage(me: Member, photo: Photo): boolean {
    return me.isOwner || photo.memberId === me.id;
  }

  async updateCaption(
    tripId: string,
    me: Member,
    id: string,
    caption: string,
  ): Promise<PhotoView> {
    const photo = await this.load(tripId, id);
    if (!this.canManage(me, photo))
      throw new ForbiddenException(
        'Only the uploader or trip owner can edit this',
      );
    photo.caption = caption.trim();
    await this.photos.save(photo);
    return photoView(
      photo,
      await this.comments.count({ where: { photoId: id } }),
    );
  }

  async remove(tripId: string, me: Member, id: string): Promise<void> {
    const photo = await this.load(tripId, id);
    if (!this.canManage(me, photo))
      throw new ForbiddenException(
        'Only the uploader or trip owner can delete this',
      );
    const paths = { id: photo.id, tripId: photo.tripId, ext: photo.ext };
    await this.photos.remove(photo);
    await this.storage.remove(paths);
  }

  /** Bytes for <img>/<a>. Unauthenticated by design; the id is an unguessable UUID. */
  async filePath(
    photoId: string,
    variant: 'original' | 'thumb' | 'preview',
  ): Promise<{ path: string; mime: string; name: string } | null> {
    const p = await this.photos.findOne({ where: { id: photoId } });
    if (!p) return null;
    if (variant === 'thumb' && !p.hasThumb) return null;
    if (variant === 'preview' && !p.hasPreview) return null;
    return {
      path: this.storage.pathFor(p, variant),
      mime: variant === 'original' ? p.mimeType : 'image/jpeg',
      name:
        variant === 'original'
          ? p.originalName
          : `${p.originalName.replace(/\.[^.]+$/, '')}-${variant}.jpg`,
    };
  }

  // ---- comments ----

  async listComments(
    tripId: string,
    photoId: string,
  ): Promise<PhotoCommentView[]> {
    await this.load(tripId, photoId);
    const rows = await this.comments.find({
      where: { tripId, photoId },
      order: { createdAt: 'ASC' },
    });
    return rows.map(photoCommentView);
  }

  async addComment(
    tripId: string,
    me: Member,
    photoId: string,
    dto: CreatePhotoCommentDto,
  ): Promise<PhotoCommentView> {
    await this.load(tripId, photoId);
    const saved = await this.comments.save(
      this.comments.create({
        tripId,
        photoId,
        memberId: me.id,
        body: dto.body.trim(),
      }),
    );
    await this.activity.record(me, 'comment', 'commented on a photo', {
      kind: 'photo',
      id: photoId,
    });
    return photoCommentView(
      await this.comments.findOneOrFail({ where: { id: saved.id } }),
    );
  }

  async deleteComment(
    tripId: string,
    me: Member,
    commentId: string,
  ): Promise<void> {
    const c = await this.comments.findOne({ where: { id: commentId, tripId } });
    if (!c) throw new NotFoundException('Comment not found');
    if (c.memberId !== me.id && !me.isOwner)
      throw new ForbiddenException(
        'Only the author or trip owner can delete this',
      );
    await this.comments.remove(c);
  }

  private async commentCounts(tripId: string): Promise<Map<string, number>> {
    const rows = await this.comments
      .createQueryBuilder('c')
      .select('c.photoId', 'photoId')
      .addSelect('COUNT(*)', 'n')
      .where('c.tripId = :tripId', { tripId })
      .groupBy('c.photoId')
      .getRawMany<{ photoId: string; n: string | number }>();
    return new Map(rows.map((r) => [r.photoId, Number(r.n)]));
  }

  // ---- zip ----

  async zipName(tripId: string): Promise<string> {
    const trip = await this.trips.findOne({ where: { id: tripId } });
    return `LetsGo - ${safeName(trip?.name ?? 'trip') || 'trip'}.zip`;
  }

  /** Oldest first, numbered, named after the uploader and the original file. */
  async zipEntries(tripId: string): Promise<ZipEntry[]> {
    const rows = await this.photos.find({
      where: { tripId },
      order: { createdAt: 'ASC' },
    });
    const used = new Set<string>();
    return rows.map((p, i) => {
      const base = `${String(i + 1).padStart(3, '0')}-${safeName(p.member.name) || 'someone'}-${safeName(p.originalName) || `photo.${p.ext}`}`;
      let name = base;
      let n = 2;
      while (used.has(name)) name = base.replace(/(\.[^.]+)?$/, ` (${n++})$1`);
      used.add(name);
      return { path: this.storage.pathFor(p, 'original'), name };
    });
  }
}

/** Strip path separators, characters that are illegal in common filesystems, and control codes. */
export function safeName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[^\x20-\x7e\u00a0-\uffff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}
