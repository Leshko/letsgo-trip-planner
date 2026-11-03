import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Repository } from 'typeorm';
import { ActivityType, Member, Notification, Trip } from '../entities';
import type { RefKind } from '../entities/notification.entity';
import { effectivePrefs, prefKeyFor } from '../common/notify-prefs';
import { refUrl } from '../common/deep-links';
import { notificationView, NotificationView } from '../common/serializers';
import { PushService } from './push.service';

/** 'all' = every member of the trip; a list = specific member ids. The actor is always excluded. */
export type Audience = 'all' | 'none' | string[];

export interface NotifyInput {
  tripId: string;
  actor: Member;
  type: ActivityType;
  message: string;
  refKind: RefKind;
  refId: string | null;
  audience: Audience;
}

const COALESCE_MS = 10 * 60_000;
const KEEP_PER_MEMBER = 200;
const PHOTO_PUSH_DEBOUNCE_MS = 10_000;

@Injectable()
export class NotificationsService implements BeforeApplicationShutdown {
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly photoTimers = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; fire: () => void }
  >();

  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
    private readonly push: PushService,
  ) {}

  async notify(input: NotifyInput): Promise<void> {
    if (input.audience === 'none') return;
    const prefKey = prefKeyFor(input.type);
    if (!prefKey) return;

    const all = await this.members.find({ where: { tripId: input.tripId } });
    const wanted = input.audience === 'all' ? null : new Set(input.audience);
    const recipients = all.filter(
      (m) =>
        m.id !== input.actor.id &&
        (!wanted || wanted.has(m.id)) &&
        effectivePrefs(m)[prefKey],
    );
    if (!recipients.length) return;

    const since = Date.now() - COALESCE_MS;
    const notifIds = new Map<string, string>();
    for (const r of recipients) {
      // Same actor, same subject, still unread and recent: update rather than pile up.
      const existing = await this.notifications.findOne({
        where: {
          memberId: r.id,
          actorId: input.actor.id,
          type: input.type,
          refKind: input.refKind ?? IsNull(),
          refId: input.refId ?? IsNull(),
          readAt: IsNull(),
          createdAt: MoreThan(since),
        },
      });
      if (existing) {
        existing.message = input.message;
        existing.createdAt = Date.now();
        await this.notifications.save(existing);
        notifIds.set(r.id, existing.id);
        continue;
      }
      const saved = await this.notifications.save(
        this.notifications.create({
          tripId: input.tripId,
          memberId: r.id,
          actorId: input.actor.id,
          type: input.type,
          message: input.message,
          refKind: input.refKind,
          refId: input.refId,
          readAt: null,
        }),
      );
      notifIds.set(r.id, saved.id);
      await this.prune(r.id);
    }

    const trip = await this.trips.findOne({ where: { id: input.tripId } });
    const title = trip?.name ?? 'LetsGo Together';
    const send = () => this.track(this.sendPush(title, input, notifIds));
    if (input.type === 'photo' && input.refId) {
      // A batch of uploads becomes one push, sent shortly after the last one lands.
      const key = `${input.tripId}:${input.refId}`;
      const prev = this.photoTimers.get(key);
      if (prev) clearTimeout(prev.timer);
      const fire = () => {
        this.photoTimers.delete(key);
        send();
      };
      const timer = setTimeout(fire, PHOTO_PUSH_DEBOUNCE_MS);
      timer.unref();
      this.photoTimers.set(key, { timer, fire });
      return;
    }
    send();
  }

  private async sendPush(
    title: string,
    input: NotifyInput,
    notifIds: Map<string, string>,
  ): Promise<void> {
    const baseUrl = refUrl(input.refKind, input.refId);
    const tag =
      input.refKind && input.refId
        ? `${input.refKind}:${input.refId}`
        : `member:${input.actor.id}`;
    // Every recipient gets the same text; the ?n= marks their own row read on click.
    for (const [memberId, notifId] of notifIds) {
      const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}n=${notifId}`;
      await this.push.sendToMembers([memberId], {
        notification: {
          title,
          body: `${input.actor.name} ${input.message}`,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag,
          renotify: false,
          data: {
            url,
            type: input.type,
            tripId: input.tripId,
            onActionClick: {
              default: { operation: 'navigateLastFocusedOrOpen', url },
            },
          },
        },
      });
    }
  }

  /** Send any batched photo push before the database closes (restarts, updates). */
  async beforeApplicationShutdown(): Promise<void> {
    await this.whenIdle();
  }

  /** Flush pending photo pushes now (tests) and wait for deliveries in flight. */
  async whenIdle(): Promise<void> {
    for (const [, pending] of [...this.photoTimers]) {
      clearTimeout(pending.timer);
      pending.fire();
    }
    await Promise.allSettled([...this.inFlight]);
  }

  private track<T>(p: Promise<T>): void {
    this.inFlight.add(p);
    void p.finally(() => this.inFlight.delete(p));
  }

  private async prune(memberId: string): Promise<void> {
    const extra = await this.notifications
      .createQueryBuilder('n')
      .select('n.id', 'id')
      .where('n.memberId = :memberId', { memberId })
      .orderBy('n.createdAt', 'DESC')
      .offset(KEEP_PER_MEMBER)
      .limit(1000)
      .getRawMany<{ id: string }>();
    if (extra.length)
      await this.notifications.delete({ id: In(extra.map((e) => e.id)) });
  }

  async list(
    tripId: string,
    memberId: string,
    limit = 30,
  ): Promise<{ items: NotificationView[]; unreadCount: number }> {
    const [rows, unreadCount] = await Promise.all([
      this.notifications.find({
        where: { tripId, memberId },
        order: { createdAt: 'DESC' },
        take: limit,
      }),
      this.notifications.count({
        where: { tripId, memberId, readAt: IsNull() },
      }),
    ]);
    return { items: rows.map(notificationView), unreadCount };
  }

  async markRead(
    tripId: string,
    memberId: string,
    ids?: string[],
  ): Promise<{ unreadCount: number }> {
    const now = Date.now();
    if (ids?.length)
      await this.notifications.update(
        { tripId, memberId, id: In(ids), readAt: IsNull() },
        { readAt: now },
      );
    else
      await this.notifications.update(
        { tripId, memberId, readAt: IsNull() },
        { readAt: now },
      );
    return {
      unreadCount: await this.notifications.count({
        where: { tripId, memberId, readAt: IsNull() },
      }),
    };
  }
}
