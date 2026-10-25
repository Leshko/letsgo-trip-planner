import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { emptyLodging, Member, Trip } from '../entities';
import { generateInviteCode, normalizeInviteCode } from '../common/invite-code';
import { isIsoDate } from '../common/dates';
import {
  tripView,
  memberView,
  TripView,
  MemberView,
} from '../common/serializers';
import {
  CreateTripDto,
  JoinTripDto,
  LodgingDto,
  UpdateProfileDto,
  UpdateTripDto,
} from './trips.dto';
import { ActivityService } from '../activity/activity.service';

export interface SessionResult {
  token: string;
  member: MemberView;
  trip: TripView;
}

@Injectable()
export class TripsService {
  constructor(
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly activity: ActivityService,
  ) {}

  private assertDates(start: string, end: string) {
    if (!isIsoDate(start) || !isIsoDate(end))
      throw new BadRequestException('Dates must be real calendar dates');
    if (end < start)
      throw new BadRequestException('End date must be on or after start date');
  }

  async create(dto: CreateTripDto): Promise<SessionResult> {
    this.assertDates(dto.startDate, dto.endDate);

    let inviteCode = generateInviteCode();
    while (await this.trips.exist({ where: { inviteCode } }))
      inviteCode = generateInviteCode();

    const trip = await this.trips.save(
      this.trips.create({
        name: dto.name.trim(),
        destination: (dto.destination ?? '').trim(),
        startDate: dto.startDate,
        endDate: dto.endDate,
        inviteCode,
        lodging: emptyLodging(),
      }),
    );
    const member = await this.members.save(
      this.newMember(trip.id, dto.memberName, true, dto.emoji),
    );
    await this.activity.record(member, 'trip', `started planning ${trip.name}`);
    return {
      token: member.token,
      member: memberView(member),
      trip: tripView(trip, [member]),
    };
  }

  private newMember(
    tripId: string,
    name: string,
    isOwner: boolean,
    emoji?: string,
  ): Member {
    const clean = name.trim();
    return this.members.create({
      tripId,
      name: clean,
      nameKey: clean.toLowerCase(),
      token: randomUUID() + randomUUID().replace(/-/g, ''),
      isOwner,
      emoji: (emoji ?? '').trim(),
    });
  }

  /**
   * Joining is trust-based: a family invite code plus a first name. If the name
   * already exists in the trip the same person is assumed (e.g. second device)
   * and their existing identity is handed back.
   */
  async join(dto: JoinTripDto): Promise<SessionResult> {
    const inviteCode = normalizeInviteCode(dto.code);
    const trip = await this.trips.findOne({ where: { inviteCode } });
    if (!trip) throw new NotFoundException('No trip with that invite code');

    const nameKey = dto.name.trim().toLowerCase();
    let member = await this.members.findOne({
      where: { tripId: trip.id, nameKey },
    });
    if (!member) {
      member = await this.members.save(
        this.newMember(trip.id, dto.name, false, dto.emoji),
      );
      await this.activity.record(member, 'joined', 'joined the trip');
    } else if (dto.emoji && !member.emoji) {
      member.emoji = dto.emoji.trim();
      await this.members.save(member);
    }

    const members = await this.listMembers(trip.id);
    return {
      token: member.token,
      member: memberView(member),
      trip: tripView(trip, members),
    };
  }

  async listMembers(tripId: string): Promise<Member[]> {
    return this.members.find({
      where: { tripId },
      order: { createdAt: 'ASC' },
    });
  }

  async getTrip(tripId: string): Promise<Trip> {
    const trip = await this.trips.findOne({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip not found');
    return trip;
  }

  async getView(tripId: string): Promise<TripView> {
    const [trip, members] = await Promise.all([
      this.getTrip(tripId),
      this.listMembers(tripId),
    ]);
    return tripView(trip, members);
  }

  async updateProfile(me: Member, dto: UpdateProfileDto): Promise<MemberView> {
    if (dto.name !== undefined) {
      const clean = dto.name.trim();
      const clash = await this.members.findOne({
        where: { tripId: me.tripId, nameKey: clean.toLowerCase() },
      });
      if (clash && clash.id !== me.id)
        throw new BadRequestException(
          'Someone in this trip already uses that name',
        );
      me.name = clean;
      me.nameKey = clean.toLowerCase();
    }
    if (dto.emoji !== undefined) me.emoji = dto.emoji.trim();
    await this.members.save(me);
    return memberView(me);
  }

  async update(
    tripId: string,
    me: Member,
    dto: UpdateTripDto,
  ): Promise<TripView> {
    const trip = await this.getTrip(tripId);
    if (dto.name !== undefined) trip.name = dto.name.trim();
    if (dto.destination !== undefined)
      trip.destination = dto.destination.trim();
    if (dto.startDate !== undefined) trip.startDate = dto.startDate;
    if (dto.endDate !== undefined) trip.endDate = dto.endDate;
    this.assertDates(trip.startDate, trip.endDate);
    await this.trips.save(trip);
    await this.activity.record(me, 'trip', 'updated the trip details');
    return this.getView(tripId);
  }

  async updateLodging(
    tripId: string,
    me: Member,
    dto: LodgingDto,
  ): Promise<TripView> {
    const trip = await this.getTrip(tripId);
    const current = { ...emptyLodging(), ...trip.lodging };
    trip.lodging = {
      name: (dto.name ?? current.name).trim(),
      address: (dto.address ?? current.address).trim(),
      checkIn: (dto.checkIn ?? current.checkIn).trim(),
      checkOut: (dto.checkOut ?? current.checkOut).trim(),
      link: (dto.link ?? current.link).trim(),
      notes: dto.notes ?? current.notes,
      photos: (dto.photos ?? current.photos)
        .map((p) => p.trim())
        .filter(Boolean),
    };
    await this.trips.save(trip);
    await this.activity.record(
      me,
      'lodging',
      trip.lodging.name
        ? `updated where we're staying: ${trip.lodging.name}`
        : "updated where we're staying",
      { kind: 'lodging', id: tripId },
    );
    return this.getView(tripId);
  }
}
