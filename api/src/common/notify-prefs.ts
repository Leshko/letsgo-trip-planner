import type { ActivityType, Member } from '../entities';

export const NOTIFY_PREF_KEYS = [
  'ideas',
  'votes',
  'comments',
  'wall',
  'plan',
  'photos',
  'members',
] as const;
export type NotifyPrefKey = (typeof NOTIFY_PREF_KEYS)[number];
export type NotifyPrefs = Record<NotifyPrefKey, boolean>;

export const DEFAULT_PREFS: NotifyPrefs = {
  ideas: true,
  votes: true,
  comments: true,
  wall: true,
  plan: true,
  photos: true,
  members: true,
};

/** Stored prefs only hold keys the person changed; everything else is on. */
export function effectivePrefs(
  member: Pick<Member, 'notifyPrefs'>,
): NotifyPrefs {
  return { ...DEFAULT_PREFS, ...(member.notifyPrefs ?? {}) };
}

export function prefKeyFor(type: ActivityType): NotifyPrefKey | null {
  switch (type) {
    case 'idea':
      return 'ideas';
    case 'vote':
      return 'votes';
    case 'comment':
      return 'comments';
    case 'post':
      return 'wall';
    case 'itinerary':
    case 'lodging':
      return 'plan';
    case 'photo':
      return 'photos';
    case 'joined':
      return 'members';
    default:
      return null;
  }
}
