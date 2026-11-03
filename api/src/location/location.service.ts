import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Member, MemberLocation, Trip } from '../entities';
import { MemberView, memberView } from '../common/serializers';
import { isTimeZone } from './location.dto';

/** A day of slack either side, so no family's time zone cuts the trip short. */
const SLACK_DAYS = 1;
/** How often finished trips are checked, so sharing ends within minutes of midnight. */
const SWEEP_MS = 5 * 60 * 1000;
/** Locations older than this are not shown at all. */
export const SHOW_FOR_MS = 6 * 60 * 60 * 1000;

export interface LocationView {
  member: MemberView;
  lat: number;
  lng: number;
  accuracy: number;
  updatedAt: number;
}

export interface LocationsView {
  live: boolean;
  locations: LocationView[];
}

function shiftDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today's date (YYYY-MM-DD) where the trip is, or null if its zone isn't known. */
export function tripToday(
  trip: Pick<Trip, 'timeZone'>,
  now = new Date(),
): string | null {
  if (!isTimeZone(trip.timeZone)) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: trip.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Is the family map open for this trip right now? From the first day to
 * midnight after the last day, in the trip's own time zone. Before any phone
 * has reported a zone, a day of slack each side covers every zone.
 */
export function isLive(
  trip: Pick<Trip, 'startDate' | 'endDate'> & Partial<Pick<Trip, 'timeZone'>>,
  now = new Date(),
): boolean {
  const local = tripToday({ timeZone: trip.timeZone ?? '' }, now);
  if (local) return local >= trip.startDate && local <= trip.endDate;
  const today = now.toISOString().slice(0, 10);
  return (
    today >= shiftDays(trip.startDate, -SLACK_DAYS) &&
    today <= shiftDays(trip.endDate, SLACK_DAYS)
  );
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;

@Injectable()
export class LocationService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Location');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(MemberLocation)
    private readonly locations: Repository<MemberLocation>,
    private readonly ds: DataSource,
  ) {}

  onModuleInit() {
    // Sweep at start and every few minutes, so a finished trip's locations are gone even if nobody opens it again.
    void this.sweep().catch((e) => this.log.warn(`Sweep failed: ${String(e)}`));
    this.timer = setInterval(
      () =>
        void this.sweep().catch((e) =>
          this.log.warn(`Sweep failed: ${String(e)}`),
        ),
      SWEEP_MS,
    );
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Switch sharing off and delete the locations of every trip that is over. */
  async sweep(now = new Date()): Promise<number> {
    // Only trips where someone is sharing; a handful at most.
    const sharing = await this.ds
      .getRepository(Trip)
      .createQueryBuilder('t')
      .where(
        'EXISTS (SELECT 1 FROM member m WHERE m."tripId" = t.id AND m."sharesLocation" = true)',
      )
      .getMany();
    const over = sharing.filter((t) => !isLive(t, now));
    for (const t of over) await this.endSharing(t.id);
    return over.length;
  }

  /** Phones on the trip know where the trip is; remember their zone. */
  private async noteTimeZone(trip: Trip, timeZone?: string) {
    if (!timeZone || !isTimeZone(timeZone) || trip.timeZone === timeZone)
      return;
    await this.ds.getRepository(Trip).update({ id: trip.id }, { timeZone });
    trip.timeZone = timeZone;
  }

  private async endSharing(tripId: string) {
    await this.ds.transaction(async (em) => {
      const ids = (
        await em
          .getRepository(Member)
          .find({ where: { tripId }, select: { id: true } })
      ).map((m) => m.id);
      if (!ids.length) return;
      await em.getRepository(MemberLocation).delete({ memberId: In(ids) });
      await em
        .getRepository(Member)
        .update({ tripId }, { sharesLocation: false });
    });
  }

  async setSharing(
    me: Member,
    on: boolean,
    timeZone?: string,
  ): Promise<MemberView> {
    await this.noteTimeZone(me.trip, timeZone);
    if (on && !isLive(me.trip)) {
      throw new ConflictException('The family map opens when the trip starts.');
    }
    await this.ds.transaction(async (em) => {
      await em
        .getRepository(Member)
        .update({ id: me.id }, { sharesLocation: on });
      if (!on)
        await em.getRepository(MemberLocation).delete({ memberId: me.id });
    });
    me.sharesLocation = on;
    return memberView(me);
  }

  async update(
    me: Member,
    lat: number,
    lng: number,
    accuracy = 0,
    timeZone?: string,
  ): Promise<{ ok: true }> {
    await this.noteTimeZone(me.trip, timeZone);
    if (!isLive(me.trip)) {
      await this.endSharing(me.tripId);
      throw new ConflictException(
        'The trip is over, so location sharing is off.',
      );
    }
    if (!me.sharesLocation) {
      throw new ConflictException('Turn on location sharing first.');
    }
    await this.locations.upsert(
      {
        memberId: me.id,
        lat: round(lat),
        lng: round(lng),
        accuracy: Math.round(Math.min(accuracy, 100_000)),
        updatedAt: Date.now(),
      },
      ['memberId'],
    );
    return { ok: true };
  }

  async list(trip: Trip): Promise<LocationsView> {
    if (!isLive(trip)) {
      await this.endSharing(trip.id);
      return { live: false, locations: [] };
    }
    const sharers = await this.members.find({
      where: { tripId: trip.id, sharesLocation: true },
    });
    if (!sharers.length) return { live: true, locations: [] };
    const rows = await this.locations.find({
      where: { memberId: In(sharers.map((m) => m.id)) },
    });
    const byId = new Map(sharers.map((m) => [m.id, m]));
    const fresh = Date.now() - SHOW_FOR_MS;
    return {
      live: true,
      locations: rows
        .filter((r) => r.updatedAt >= fresh)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((r) => ({
          member: memberView(byId.get(r.memberId)!),
          lat: r.lat,
          lng: r.lng,
          accuracy: r.accuracy,
          updatedAt: r.updatedAt,
        })),
    };
  }
}
