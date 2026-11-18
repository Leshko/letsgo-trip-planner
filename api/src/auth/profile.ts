import { BadRequestException } from '@nestjs/common';
import { EntityManager, Not } from 'typeorm';
import { Member, User } from '../entities';

/**
 * One profile everywhere: a signed-in person's name, emoji and photo belong
 * to their account. Every trip spot linked to the account carries a copy
 * (photos are served per spot), and these functions keep the copies in step.
 * They take an EntityManager so they can run inside a caller's transaction.
 */

/** The account with its photo bytes (normally left out of queries). */
export async function loadProfile(
  m: EntityManager,
  userId: string,
): Promise<User> {
  const user = await m
    .createQueryBuilder(User, 'u')
    .addSelect('u.avatar')
    .where('u.id = :userId', { userId })
    .getOneOrFail();
  return user;
}

/**
 * Copy the profile onto all of the account's spots. Names are unique within
 * a trip: where someone else already has the name, that spot keeps its own.
 */
export async function syncProfile(
  m: EntityManager,
  user: User,
  what: { photo: boolean },
): Promise<void> {
  const spots = await m.find(Member, { where: { userId: user.id } });
  const nameKey = user.profileName.trim().toLowerCase();
  for (const spot of spots) {
    const patch: Partial<Member> = {};
    if (spot.emoji !== user.emoji) patch.emoji = user.emoji;
    if (what.photo) {
      patch.avatar = user.avatar ?? null;
      patch.avatarType = user.avatar ? user.avatarType : '';
      patch.avatarVersion = user.avatar ? (spot.avatarVersion ?? 0) + 1 : 0;
    }
    if (nameKey && spot.nameKey !== nameKey) {
      const taken = await m.exists(Member, {
        where: { tripId: spot.tripId, nameKey, id: Not(spot.id) },
      });
      if (!taken) {
        patch.name = user.profileName.trim();
        patch.nameKey = nameKey;
      }
    } else if (nameKey && spot.name !== user.profileName.trim()) {
      // Same name, different capitals.
      patch.name = user.profileName.trim();
    }
    if (Object.keys(patch).length)
      await m.update(Member, { id: spot.id }, patch);
  }
}

/**
 * A spot was just linked to an account (saved to it, joined as an existing
 * name, linked by an admin). Whatever the profile is missing comes from the
 * spot; whatever it already has wins and is applied to the spot.
 */
export async function adoptSpot(
  m: EntityManager,
  userId: string,
  memberId: string,
  /**
   * An admin merged a rejoined spot ("Dad 2") into the original ("Dad"): the
   * original's name is the one to keep, when the account is in no other trip.
   */
  opts: { spotNameIfOnlySpot?: boolean } = {},
): Promise<void> {
  const user = await loadProfile(m, userId);
  const spot = await m
    .createQueryBuilder(Member, 'mb')
    .addSelect('mb.avatar')
    .where('mb.id = :memberId', { memberId })
    .getOne();
  if (!spot) return;
  const elsewhere = opts.spotNameIfOnlySpot
    ? await m.count(Member, { where: { userId, id: Not(spot.id) } })
    : 1;
  if (!user.profileName || elsewhere === 0) user.profileName = spot.name;
  if (!user.emoji) user.emoji = spot.emoji ?? '';
  if (!user.avatar && spot.avatar) {
    user.avatar = spot.avatar;
    user.avatarType = spot.avatarType;
    user.avatarVersion = (user.avatarVersion ?? 0) + 1;
  }
  await saveProfile(m, user);
  await syncProfile(m, user, { photo: true });
}

/**
 * What a new spot for this account starts with. A brand-new account has no
 * profile yet: what they typed becomes it.
 */
export async function profileForNewSpot(
  m: EntityManager,
  userId: string,
  typed: { name?: string; emoji?: string },
): Promise<User> {
  const user = await loadProfile(m, userId);
  if (!user.profileName) {
    const name = (typed.name ?? '').trim();
    if (!name) throw new BadRequestException('Tell us your name');
    user.profileName = name;
    if (!user.emoji) user.emoji = (typed.emoji ?? '').trim();
    await saveProfile(m, user);
  }
  return user;
}

/** A change made from any one spot: save it to the account and copy it everywhere. */
export async function changeProfile(
  m: EntityManager,
  userId: string,
  patch: {
    name?: string;
    emoji?: string;
    /** null removes the photo. */
    photo?: { bytes: Buffer; type: string } | null;
  },
): Promise<void> {
  const user = await loadProfile(m, userId);
  if (patch.name !== undefined) user.profileName = patch.name.trim();
  if (patch.emoji !== undefined) user.emoji = patch.emoji.trim();
  if (patch.photo !== undefined) {
    user.avatar = patch.photo ? patch.photo.bytes : null;
    user.avatarType = patch.photo ? patch.photo.type : '';
    user.avatarVersion = patch.photo ? (user.avatarVersion ?? 0) + 1 : 0;
  }
  await saveProfile(m, user);
  await syncProfile(m, user, { photo: patch.photo !== undefined });
}

async function saveProfile(m: EntityManager, user: User): Promise<void> {
  await m.update(
    User,
    { id: user.id },
    {
      profileName: user.profileName,
      emoji: user.emoji,
      avatar: user.avatar ?? null,
      avatarType: user.avatarType,
      avatarVersion: user.avatarVersion,
    },
  );
}

/** Give a new (unsaved) spot the account's profile. */
export function dressSpot(spot: Member, user: User): Member {
  const name = user.profileName.trim();
  spot.name = name;
  spot.nameKey = name.toLowerCase();
  spot.emoji = user.emoji ?? '';
  spot.avatar = user.avatar ?? null;
  spot.avatarType = user.avatar ? user.avatarType : '';
  spot.avatarVersion = user.avatar ? 1 : 0;
  return spot;
}
