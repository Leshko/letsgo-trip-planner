import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Activity, ActivityType, Member } from '../entities';
import { activityView, ActivityView } from '../common/serializers';

@Injectable()
export class ActivityService {
  constructor(
    @InjectRepository(Activity) private readonly activity: Repository<Activity>,
  ) {}

  async record(
    member: Member,
    type: ActivityType,
    message: string,
    ref?: { kind: Activity['refKind']; id: string },
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
