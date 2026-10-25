import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Idea, ItineraryEntry, Member } from '../entities';
import { itineraryEntryView, ItineraryEntryView } from '../common/serializers';
import { CreateEntryDto, ReorderDto, UpdateEntryDto } from './itinerary.dto';
import { dateRange } from '../common/dates';
import { TripsService } from '../trips/trips.service';
import { ActivityService } from '../activity/activity.service';

export interface ItineraryDay {
  date: string;
  entries: ItineraryEntryView[];
}

@Injectable()
export class ItineraryService {
  constructor(
    @InjectRepository(ItineraryEntry)
    private readonly entries: Repository<ItineraryEntry>,
    @InjectRepository(Idea) private readonly ideas: Repository<Idea>,
    private readonly trips: TripsService,
    private readonly activity: ActivityService,
  ) {}

  /** Every day of the trip, in order, even the empty ones. Entries outside the
   *  trip window (dates were edited after planning) are kept in their own days. */
  async list(tripId: string): Promise<ItineraryDay[]> {
    const trip = await this.trips.getTrip(tripId);
    const rows = await this.entries.find({
      where: { tripId },
      order: { date: 'ASC', position: 'ASC' },
    });
    const byDate = new Map<string, ItineraryEntryView[]>();
    for (const d of dateRange(trip.startDate, trip.endDate)) byDate.set(d, []);
    for (const row of rows) {
      if (!byDate.has(row.date)) byDate.set(row.date, []);
      byDate.get(row.date)!.push(itineraryEntryView(row));
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, entries]) => ({ date, entries: sortEntries(entries) }));
  }

  private async load(tripId: string, id: string): Promise<ItineraryEntry> {
    const e = await this.entries.findOne({ where: { id, tripId } });
    if (!e) throw new NotFoundException('Itinerary entry not found');
    return e;
  }

  private async nextPosition(tripId: string, date: string): Promise<number> {
    const last = await this.entries.findOne({
      where: { tripId, date },
      order: { position: 'DESC' },
    });
    return last ? last.position + 1 : 0;
  }

  async create(
    tripId: string,
    me: Member,
    dto: CreateEntryDto,
  ): Promise<ItineraryEntryView> {
    let title = (dto.title ?? '').trim();
    let ideaId: string | null = null;
    if (dto.ideaId) {
      const idea = await this.ideas.findOne({
        where: { id: dto.ideaId, tripId },
      });
      if (!idea) throw new NotFoundException('Idea not found');
      ideaId = idea.id;
      if (!title) title = idea.title;
    }
    if (!title) throw new BadRequestException('A title or an idea is required');

    const saved = await this.entries.save(
      this.entries.create({
        tripId,
        date: dto.date,
        startTime: dto.startTime ?? '',
        title,
        notes: (dto.notes ?? '').trim(),
        ideaId,
        position: await this.nextPosition(tripId, dto.date),
        addedById: me.id,
      }),
    );
    await this.activity.record(
      me,
      'itinerary',
      `put ${title} on the plan for ${prettyDate(dto.date)}`,
      {
        kind: 'itinerary',
        id: saved.id,
      },
    );
    return itineraryEntryView(await this.load(tripId, saved.id));
  }

  async update(
    tripId: string,
    id: string,
    dto: UpdateEntryDto,
  ): Promise<ItineraryEntryView> {
    const e = await this.load(tripId, id);
    if (dto.date !== undefined && dto.date !== e.date) {
      e.date = dto.date;
      e.position = await this.nextPosition(tripId, dto.date);
    }
    if (dto.startTime !== undefined) e.startTime = dto.startTime;
    if (dto.title !== undefined) e.title = dto.title.trim();
    if (dto.notes !== undefined) e.notes = dto.notes.trim();
    await this.entries.save(e);
    return itineraryEntryView(await this.load(tripId, id));
  }

  async remove(tripId: string, id: string): Promise<void> {
    await this.entries.remove(await this.load(tripId, id));
  }

  /** Set the order of a day's entries; also moves listed entries into that day. */
  async reorder(tripId: string, dto: ReorderDto): Promise<ItineraryDay[]> {
    if (dto.entryIds.length) {
      const rows = await this.entries.find({
        where: { tripId, id: In(dto.entryIds) },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const updates: ItineraryEntry[] = [];
      dto.entryIds.forEach((id, idx) => {
        const row = byId.get(id);
        if (!row) throw new NotFoundException(`Entry ${id} not found`);
        row.date = dto.date;
        row.position = idx;
        updates.push(row);
      });
      await this.entries.save(updates);
    }
    return this.list(tripId);
  }
}

function prettyDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Timed entries sort by clock, unscheduled ones keep their manual order after them. */
function sortEntries(entries: ItineraryEntryView[]): ItineraryEntryView[] {
  return [...entries].sort((a, b) => {
    if (a.startTime && b.startTime)
      return a.startTime.localeCompare(b.startTime) || a.position - b.position;
    if (a.startTime) return -1;
    if (b.startTime) return 1;
    return a.position - b.position;
  });
}
