import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Activity, ActivityType, Member } from '../entities';
import { activityView, ActivityView } from '../common/serializers';
import {
  Audience,
  NotificationsService,
} from '../notifications/notifications.service';

@Injectable()
export class ActivityService {
  constructor(
    @InjectRepository(Activity) private readonly activity: Repository<Activity>,
    private readonly notifications: NotificationsService,
  ) {}

  async record(
    member: Member,
    type: ActivityType,
    message: string,
    ref?: { kind: Activity['refKind']; id: string },
    audience: Audience = 'all',
  ): Promise<void> {
    await this.activity.save(
      this.activity.create({
        tripId: member.tripId,
        memberId: member.id,
        type,
        message,
        refKind: ref?.kind ?? null,
        refId: ref?.id ?? null,
      }),
    );
    await this.notifications.notify({
      tripId: member.tripId,
      actor: member,
      type,
      message,
      refKind: ref?.kind ?? null,
      refId: ref?.id ?? null,
      audience,
    });
  }

  /** One feed line per upload batch, updated as more photos in that batch arrive. */
  async recordBatch(
    member: Member,
    batchId: string,
    count: number,
  ): Promise<void> {
    const message = count === 1 ? 'added a photo' : `added ${count} photos`;
    const existing = await this.activity.findOne({
      where: {
        tripId: member.tripId,
        memberId: member.id,
        type: 'photo',
        refKind: 'photo',
        refId: batchId,
      },
    });
    if (existing) {
      existing.message = message;
      await this.activity.save(existing);
      await this.notifications.notify({
        tripId: member.tripId,
        actor: member,
        type: 'photo',
        message,
        refKind: 'photo',
        refId: batchId,
        audience: 'all',
      });
      return;
    }
    await this.record(member, 'photo', message, { kind: 'photo', id: batchId });
  }

  async recent(tripId: string, limit = 40): Promise<ActivityView[]> {
    const rows = await this.activity.find({
      where: { tripId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows.map(activityView);
  }
}
