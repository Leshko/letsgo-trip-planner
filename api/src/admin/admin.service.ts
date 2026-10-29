import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  Activity,
  Comment,
  Idea,
  ItineraryEntry,
  Member,
  MemberAlias,
  Notification,
  Photo,
  PhotoComment,
  Post,
  PushSubscription,
  TransferCode,
  Trip,
  Vote,
} from '../entities';

export interface AdminMember {
  id: string;
  name: string;
  emoji: string;
  avatarUrl: string;
  isOwner: boolean;
  joinedAt: string;
  /** What this spot has added, so a duplicate is easy to spot. */
  counts: {
    votes: number;
    ideas: number;
    comments: number;
    photos: number;
    posts: number;
  };
  /** Extra devices merged into this spot. */
  mergedDevices: number;
}

export interface AdminTrip {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  inviteCode: string;
  createdAt: string;
  lastActivityAt: string | null;
  counts: { members: number; ideas: number; photos: number; posts: number };
  members: AdminMember[];
}

export interface MergeResult {
  trip: AdminTrip;
  moved: Record<string, number>;
}

@Injectable()
export class AdminService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async trips(): Promise<AdminTrip[]> {
    const trips = await this.ds
      .getRepository(Trip)
      .find({ order: { createdAt: 'DESC' } });
    const out: AdminTrip[] = [];
    for (const t of trips) out.push(await this.trip(t));
    // Most recently active first.
    return out.sort((a, b) =>
      (b.lastActivityAt ?? b.createdAt).localeCompare(
        a.lastActivityAt ?? a.createdAt,
      ),
    );
  }

  async tripById(tripId: string): Promise<AdminTrip> {
    const t = await this.ds
      .getRepository(Trip)
      .findOne({ where: { id: tripId } });
    if (!t) throw new NotFoundException('Trip not found');
    return this.trip(t);
  }

  private async trip(
    t: Trip,
    m: EntityManager = this.ds.manager,
  ): Promise<AdminTrip> {
    const members = await m.find(Member, {
      where: { tripId: t.id },
      order: { createdAt: 'ASC' },
    });
    const ids = members.map((x) => x.id);
    const count = async (
      entity: new () => unknown,
      column: string,
    ): Promise<Map<string, number>> => {
      if (!ids.length) return new Map();
      const rows = await m
        .createQueryBuilder(entity, 'x')
        .select(`x.${column}`, 'id')
        .addSelect('COUNT(*)', 'n')
        .where(`x.${column} IN (:...ids)`, { ids })
        .groupBy(`x.${column}`)
        .getRawMany<{ id: string; n: string | number }>();
      return new Map(rows.map((r) => [r.id, Number(r.n)]));
    };
    const [votes, ideas, comments, photos, posts, photoComments, aliases] =
      await Promise.all([
        count(Vote, 'memberId'),
        count(Idea, 'suggestedById'),
        count(Comment, 'memberId'),
        count(Photo, 'memberId'),
        count(Post, 'memberId'),
        count(PhotoComment, 'memberId'),
        count(MemberAlias, 'memberId'),
      ]);
    const last = await m
      .createQueryBuilder(Activity, 'a')
      .select('MAX(a.createdAt)', 'at')
      .where('a.tripId = :id', { id: t.id })
      .getRawOne<{ at: string | number | null }>();
    const total = (map: Map<string, number>) =>
      [...map.values()].reduce((a, b) => a + b, 0);
    return {
      id: t.id,
      name: t.name,
      destination: t.destination,
      startDate: t.startDate,
      endDate: t.endDate,
      inviteCode: t.inviteCode,
      createdAt: new Date(t.createdAt).toISOString(),
      lastActivityAt: last?.at ? new Date(Number(last.at)).toISOString() : null,
      counts: {
        members: members.length,
        ideas: total(ideas),
        photos: total(photos),
        posts: total(posts),
      },
      members: members.map((x) => ({
        id: x.id,
        name: x.name,
        emoji: x.emoji ?? '',
        avatarUrl: x.avatarVersion
          ? `/api/avatars/${x.id}?v=${x.avatarVersion}`
          : '',
        isOwner: x.isOwner,
        joinedAt: new Date(x.createdAt).toISOString(),
        counts: {
          votes: votes.get(x.id) ?? 0,
          ideas: ideas.get(x.id) ?? 0,
          comments: (comments.get(x.id) ?? 0) + (photoComments.get(x.id) ?? 0),
          photos: photos.get(x.id) ?? 0,
          posts: posts.get(x.id) ?? 0,
        },
        mergedDevices: aliases.get(x.id) ?? 0,
      })),
    };
  }

  /**
   * Fold a duplicate spot ("from", usually made when someone rejoined) into
   * their original one ("into"). Everything "from" did moves to "into", duplicate
   * votes collapse, and the devices signed in as "from" now open "into".
   * All in one transaction.
   */
  async merge(
    tripId: string,
    fromId: string,
    intoId: string,
  ): Promise<MergeResult> {
    if (fromId === intoId)
      throw new BadRequestException('Pick two different people');
    return this.ds.transaction(async (m) => {
      const [from, into] = await Promise.all([
        m.findOne(Member, { where: { id: fromId }, select: memberColumns(m) }),
        m.findOne(Member, { where: { id: intoId }, select: memberColumns(m) }),
      ]);
      if (!from || !into || from.tripId !== tripId || into.tripId !== tripId)
        throw new NotFoundException('Both people must be in this trip');

      const moved: Record<string, number> = {};
      const move = async (
        entity: new () => unknown,
        column: string,
        label: string,
      ) => {
        const r = await m.update(
          entity,
          { [column]: fromId },
          { [column]: intoId },
        );
        if (r.affected) moved[label] = (moved[label] ?? 0) + r.affected;
      };

      // Votes: keep one per idea.
      const intoVotes = await m.find(Vote, { where: { memberId: intoId } });
      const already = intoVotes.map((v) => v.ideaId);
      if (already.length)
        await m.delete(Vote, { memberId: fromId, ideaId: In(already) });
      await move(Vote, 'memberId', 'votes');

      await move(Idea, 'suggestedById', 'ideas');
      await move(Comment, 'memberId', 'comments');
      await move(PhotoComment, 'memberId', 'comments');
      await move(Photo, 'memberId', 'photos');
      await move(Post, 'memberId', 'posts');
      await move(ItineraryEntry, 'addedById', 'plan entries');
      await move(Activity, 'memberId', 'activity');
      await move(Notification, 'memberId', 'notifications');
      await move(Notification, 'actorId', 'notifications');
      // A notification about your own action is noise.
      await m.delete(Notification, { memberId: intoId, actorId: intoId });
      // Their phone's push notifications now arrive for the kept spot.
      await move(PushSubscription, 'memberId', 'push devices');
      await m.delete(TransferCode, { memberId: fromId });

      // Emoji reactions on wall posts store member ids.
      const posts = await m.find(Post, { where: { tripId } });
      for (const p of posts) {
        let changed = false;
        const next: Record<string, string[]> = {};
        for (const [emoji, who] of Object.entries(p.reactions ?? {})) {
          if (who.includes(fromId)) changed = true;
          next[emoji] = [
            ...new Set(who.map((w) => (w === fromId ? intoId : w))),
          ];
        }
        if (changed) {
          p.reactions = next;
          await m.save(p);
          moved['reactions'] = (moved['reactions'] ?? 0) + 1;
        }
      }

      // Keep the old spot's name; fill in what it's missing.
      if (!into.emoji && from.emoji) into.emoji = from.emoji;
      if (!into.avatarType && from.avatarType && from.avatar) {
        into.avatar = from.avatar;
        into.avatarType = from.avatarType;
        into.avatarVersion = (into.avatarVersion ?? 0) + 1;
      }
      if (from.isOwner) into.isOwner = true;
      await m.save(Member, into);

      // Every device signed in as "from" (and anything merged into it before) now opens "into".
      await m.update(MemberAlias, { memberId: fromId }, { memberId: intoId });
      await m.insert(MemberAlias, {
        token: from.token,
        memberId: intoId,
        createdAt: Date.now(),
      });
      await m.delete(Member, { id: fromId });

      const trip = await m.findOneOrFail(Trip, { where: { id: tripId } });
      return { trip: await this.trip(trip, m), moved };
    });
  }
}

/** Every column including the avatar bytes, which are normally left out. */
function memberColumns(m: EntityManager): (keyof Member)[] {
  return m.connection
    .getMetadata(Member)
    .columns.map((c) => c.propertyName as keyof Member);
}
