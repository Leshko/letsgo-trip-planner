import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { emptyLodging, Member, TransferCode, Trip, User } from '../entities';
import { AccountService } from '../auth/account.service';
import {
  adoptSpot,
  changeProfile,
  dressSpot,
  loadProfile,
  profileForNewSpot,
} from '../auth/profile';
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
  AvatarDto,
  LodgingDto,
  TransferDto,
  UpdateProfileDto,
  UpdateTripDto,
} from './trips.dto';
import { ActivityService } from '../activity/activity.service';
import {
  effectivePrefs,
  NOTIFY_PREF_KEYS,
  NotifyPrefs,
} from '../common/notify-prefs';

const TRANSFER_TTL_MS = 10 * 60_000;
const AVATAR_MAX_BYTES = 250_000;

export interface SessionResult {
  token: string;
  member: MemberView;
  trip: TripView;
  /** Whether this trip spot is saved to an account. */
  accountLinked: boolean;
}

@Injectable()
export class TripsService {
  constructor(
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(TransferCode)
    private readonly transfers: Repository<TransferCode>,
    private readonly activity: ActivityService,
    private readonly account: AccountService,
  ) {}

  private assertDates(start: string, end: string) {
    if (!isIsoDate(start) || !isIsoDate(end))
      throw new BadRequestException('Dates must be real calendar dates');
    if (end < start)
      throw new BadRequestException('End date must be on or after start date');
  }

  async create(dto: CreateTripDto, user: User | null): Promise<SessionResult> {
    this.assertDates(dto.startDate, dto.endDate);
    // Signed in: the account's profile is used (what was typed only matters the first time).
    const profile = user
      ? await profileForNewSpot(this.members.manager, user.id, {
          name: dto.memberName,
          emoji: dto.emoji,
        })
      : null;
    const memberName = profile?.profileName ?? (dto.memberName ?? '').trim();
    if (!memberName) throw new BadRequestException('Tell us your name');

    let inviteCode = generateInviteCode();
    while (await this.trips.exist({ where: { inviteCode } }))
      inviteCode = generateInviteCode();

    const trip = await this.trips.save(
      this.trips.create({
        kind: dto.kind ?? 'trip',
        name: dto.name.trim(),
        destination: (dto.destination ?? '').trim(),
        startDate: dto.startDate,
        endDate: dto.endDate,
        inviteCode,
        lodging: emptyLodging(),
        ownerUserId: user?.id ?? null,
      }),
    );
    const spot = this.newMember(
      trip.id,
      memberName,
      true,
      dto.emoji,
      user?.id ?? null,
    );
    const member = await this.members.save(
      profile ? dressSpot(spot, profile) : spot,
    );
    await this.activity.record(
      member,
      'trip',
      trip.kind === 'gathering'
        ? `set up ${trip.name}`
        : `started planning ${trip.name}`,
      undefined,
      'none',
    );
    return {
      token: member.token,
      accountLinked: !!member.userId,
      member: memberView(member),
      trip: tripView(trip, [member]),
    };
  }

  private newMember(
    tripId: string,
    name: string,
    isOwner: boolean,
    emoji?: string,
    userId: string | null = null,
  ): Member {
    const clean = name.trim();
    return this.members.create({
      tripId,
      name: clean,
      nameKey: clean.toLowerCase(),
      token: randomUUID() + randomUUID().replace(/-/g, ''),
      isOwner,
      emoji: (emoji ?? '').trim(),
      userId,
    });
  }

  /**
   * Joining is trust-based: a family invite code plus a first name. If the name
   * already exists in the trip the same person is assumed (e.g. second device)
   * and their existing identity is handed back, unless that spot is saved to
   * an account, in which case only that account can have it.
   */
  async join(
    dto: JoinTripDto,
    user: User | null = null,
  ): Promise<SessionResult> {
    const inviteCode = normalizeInviteCode(dto.code);
    const trip = await this.trips.findOne({ where: { inviteCode } });
    if (!trip) throw new NotFoundException('No trip with that invite code');

    // Signed in and already in this trip: just open it.
    let member = user
      ? await this.members.findOne({
          where: { tripId: trip.id, userId: user.id },
        })
      : null;
    if (member) return this.session(trip, member);

    // Signed in with a profile: that name is used. What was typed is only a
    // fallback for when someone else in this trip already has the name.
    const profile = user
      ? await loadProfile(this.members.manager, user.id)
      : null;
    const typed = (dto.name ?? '').trim();
    let name = profile?.profileName.trim() || typed;
    if (!name) throw new BadRequestException('Tell us your name');
    const find = (n: string) =>
      this.members.findOne({
        where: { tripId: trip.id, nameKey: n.toLowerCase() },
      });
    member = await find(name);
    if (
      member?.userId &&
      user &&
      typed &&
      typed.toLowerCase() !== name.toLowerCase()
    ) {
      // Their usual name is taken here; they picked another for this one.
      name = typed;
      member = await find(name);
    }
    if (member?.userId) {
      throw new ConflictException({
        message: user
          ? `Someone named ${member.name} is already in this ${trip.kind === 'gathering' ? 'gathering' : 'trip'}. What should we call you here?`
          : `${member.name} signs in with an account. Sign in to continue as ${member.name}, or use a different name.`,
        code: 'name_taken',
      });
    }
    if (!member) {
      const spot = this.newMember(
        trip.id,
        name,
        false,
        dto.emoji,
        user?.id ?? null,
      );
      if (user) {
        const p = await profileForNewSpot(this.members.manager, user.id, {
          name,
          emoji: dto.emoji,
        });
        dressSpot(spot, p);
        // A different name just for this trip (their usual one was taken).
        spot.name = name;
        spot.nameKey = name.toLowerCase();
      }
      member = await this.members.save(spot);
      await this.activity.record(
        member,
        'joined',
        trip.kind === 'gathering' ? 'joined the gathering' : 'joined the trip',
      );
    } else if (user) {
      // An existing spot with that name becomes theirs, and takes on their profile.
      member.userId = user.id;
      if (dto.emoji && !member.emoji) member.emoji = dto.emoji.trim();
      await this.members.save(member);
      await this.account.adoptOwnership(member, user);
      await adoptSpot(this.members.manager, user.id, member.id);
      member = await this.members.findOneOrFail({ where: { id: member.id } });
    } else if (dto.emoji && !member.emoji) {
      member.emoji = dto.emoji.trim();
      await this.members.save(member);
    }

    const members = await this.listMembers(trip.id);
    return {
      token: member.token,
      accountLinked: !!member.userId,
      member: memberView(member),
      trip: tripView(trip, members),
    };
  }

  private async session(trip: Trip, member: Member): Promise<SessionResult> {
    const members = await this.listMembers(trip.id);
    return {
      token: member.token,
      accountLinked: !!member.userId,
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

  /** A code the person reads off one screen and types into another. 10 minutes, one use. */
  async createTransferCode(
    me: Member,
  ): Promise<{ code: string; expiresAt: number }> {
    // Any earlier unused codes for this person stop working.
    await this.transfers.delete({ memberId: me.id, usedAt: IsNull() });
    let code = generateInviteCode(8);
    while (await this.transfers.exist({ where: { code } }))
      code = generateInviteCode(8);
    const expiresAt = Date.now() + TRANSFER_TTL_MS;
    await this.transfers.save(
      this.transfers.create({ code, memberId: me.id, expiresAt, usedAt: null }),
    );
    return { code, expiresAt };
  }

  async redeemTransferCode(dto: TransferDto): Promise<SessionResult> {
    const code = normalizeInviteCode(dto.code);
    const t = await this.transfers.findOne({ where: { code } });
    if (!t || t.usedAt || t.expiresAt < Date.now()) {
      throw new NotFoundException(
        'That login code is wrong, used, or has expired',
      );
    }
    t.usedAt = Date.now();
    await this.transfers.save(t);
    const member = t.member;
    const [trip, members] = await Promise.all([
      this.getTrip(member.tripId),
      this.listMembers(member.tripId),
    ]);
    return {
      token: member.token,
      accountLinked: !!member.userId,
      member: memberView(member),
      trip: tripView(trip, members),
    };
  }

  async setAvatar(me: Member, dto: AvatarDto | null): Promise<MemberView> {
    if (!dto) {
      if (me.userId) {
        // Their profile photo: removed from every trip and gathering.
        await changeProfile(this.members.manager, me.userId, { photo: null });
        return memberView(
          await this.members.findOneOrFail({ where: { id: me.id } }),
        );
      }
      me.avatar = null;
      me.avatarType = '';
      me.avatarVersion = 0;
      await this.members.save(me);
      return memberView(me);
    }
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
      dto.dataUrl,
    );
    if (!m) throw new BadRequestException('Send a JPEG, PNG or WebP image');
    const bytes = Buffer.from(m[2], 'base64');
    if (bytes.length < 100 || bytes.length > AVATAR_MAX_BYTES)
      throw new BadRequestException('Image must be under 250 KB');
    if (me.userId) {
      // Their profile photo: the same in every trip and gathering.
      await changeProfile(this.members.manager, me.userId, {
        photo: { bytes, type: m[1] },
      });
      return memberView(
        await this.members.findOneOrFail({ where: { id: me.id } }),
      );
    }
    me.avatar = bytes;
    me.avatarType = m[1];
    me.avatarVersion = (me.avatarVersion ?? 0) + 1;
    await this.members.save(me);
    return memberView(me);
  }

  /** Raw bytes for <img src>; null when the member has no photo. */
  async getAvatar(
    memberId: string,
  ): Promise<{ bytes: Buffer; type: string } | null> {
    const row = await this.members
      .createQueryBuilder('m')
      .addSelect('m.avatar')
      .where('m.id = :id', { id: memberId })
      .getOne();
    if (!row?.avatar || !row.avatarType) return null;
    return { bytes: Buffer.from(row.avatar), type: row.avatarType };
  }

  async updateNotifyPrefs(
    me: Member,
    dto: Partial<NotifyPrefs>,
  ): Promise<{ notifyPrefs: NotifyPrefs }> {
    const next: Record<string, boolean> = { ...(me.notifyPrefs ?? {}) };
    for (const key of NOTIFY_PREF_KEYS)
      if (typeof dto[key] === 'boolean') next[key] = dto[key];
    me.notifyPrefs = next;
    await this.members.save(me);
    return { notifyPrefs: effectivePrefs(me) };
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
    if (me.userId) {
      // Saved to an account: it's their profile, so it follows them everywhere.
      await changeProfile(this.members.manager, me.userId, {
        name: dto.name,
        emoji: dto.emoji,
      });
    }
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
    await this.activity.record(
      me,
      'trip',
      trip.kind === 'gathering'
        ? 'updated the gathering details'
        : 'updated the trip details',
      undefined,
      'none',
    );
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
      trip.kind === 'gathering'
        ? trip.lodging.name
          ? `updated where & when: ${trip.lodging.name}`
          : 'updated where & when'
        : trip.lodging.name
          ? `updated where we're staying: ${trip.lodging.name}`
          : "updated where we're staying",
      { kind: 'lodging', id: tripId },
    );
    return this.getView(tripId);
  }
}
