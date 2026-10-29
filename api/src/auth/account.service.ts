import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Member, Trip, User } from '../entities';
import {
  memberView,
  MemberView,
  tripView,
  TripView,
} from '../common/serializers';

export interface MyTrip {
  trip: TripView;
  member: MemberView;
  /** The member token for this trip, so the app can open it without another sign-in. */
  token: string;
}

@Injectable()
export class AccountService {
  constructor(
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
  ) {}

  /** Every trip this account is part of, upcoming and most recent first. */
  async myTrips(user: User): Promise<MyTrip[]> {
    const mine = await this.members.find({
      where: { userId: user.id },
      relations: { trip: true },
    });
    if (!mine.length) return [];
    const all = await this.members.find({
      where: { tripId: In(mine.map((m) => m.tripId)) },
      order: { createdAt: 'ASC' },
    });
    return mine
      .map((m) => ({
        trip: tripView(
          m.trip,
          all.filter((x) => x.tripId === m.tripId),
        ),
        member: memberView(m),
        token: m.token,
      }))
      .sort((a, b) => b.trip.startDate.localeCompare(a.trip.startDate));
  }

  /**
   * Attach a spot someone already has in a trip (from before accounts, or from
   * joining without one) to their account. Their votes, photos and comments come along.
   */
  async claim(user: User, memberToken: string): Promise<MyTrip> {
    const member = await this.members.findOne({
      where: { token: memberToken },
      relations: { trip: true },
    });
    if (!member) throw new NotFoundException('That trip spot no longer exists');
    if (member.userId && member.userId !== user.id)
      throw new ConflictException(
        `${member.name} in ${member.trip.name} is already saved to a different account`,
      );
    if (!member.userId) {
      const other = await this.members.findOne({
        where: { tripId: member.tripId, userId: user.id },
      });
      if (other)
        throw new ConflictException(
          `Your account is already in ${member.trip.name} as ${other.name}`,
        );
      member.userId = user.id;
      await this.members.save(member);
      await this.adoptOwnership(member, user);
    }
    return (await this.myTrips(user)).find((t) => t.member.id === member.id)!;
  }

  /** The organizer's account becomes the trip's owner account the first time it's linked. */
  async adoptOwnership(member: Member, user: User): Promise<void> {
    if (!member.isOwner) return;
    await this.trips.update(
      { id: member.tripId, ownerUserId: IsNull() },
      { ownerUserId: user.id },
    );
  }
}
