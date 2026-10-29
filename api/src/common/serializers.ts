import {
  Activity,
  Comment,
  Idea,
  ItineraryEntry,
  Member,
  Notification,
  Photo,
  PhotoComment,
  Post,
  Trip,
} from '../entities';
import { refUrl } from './deep-links';

export interface MemberView {
  id: string;
  name: string;
  isOwner: boolean;
  emoji: string;
  /** Versioned URL of the uploaded photo, or '' when there is none. */
  avatarUrl: string;
}

export interface TripView {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  inviteCode: string;
  lodging: Trip['lodging'];
  members: MemberView[];
  createdAt: string;
}

export interface IdeaView {
  id: string;
  kind: Idea['kind'];
  title: string;
  description: string;
  link: string;
  address: string;
  menuUrl: string;
  cost: Idea['cost'];
  imageUrl: string;
  siteName: string;
  details: { label: string; value: string }[];
  suggestedBy: MemberView;
  voteCount: number;
  voters: MemberView[];
  votedByMe: boolean;
  commentCount: number;
  createdAt: string;
}

export interface ItineraryEntryView {
  id: string;
  date: string;
  startTime: string;
  title: string;
  notes: string;
  position: number;
  ideaId: string | null;
  idea: Pick<
    IdeaView,
    'id' | 'kind' | 'title' | 'link' | 'address' | 'imageUrl'
  > | null;
  addedBy: MemberView;
}

export const memberView = (m: Member): MemberView => ({
  id: m.id,
  name: m.name,
  isOwner: m.isOwner,
  emoji: m.emoji ?? '',
  avatarUrl: m.avatarVersion ? `/api/avatars/${m.id}?v=${m.avatarVersion}` : '',
});

export const tripView = (t: Trip, members: Member[]): TripView => ({
  id: t.id,
  name: t.name,
  destination: t.destination,
  startDate: t.startDate,
  endDate: t.endDate,
  inviteCode: t.inviteCode,
  lodging: t.lodging,
  members: members.map(memberView),
  createdAt: new Date(t.createdAt).toISOString(),
});

export const ideaView = (i: Idea, meId: string, commentCount = 0): IdeaView => {
  const votes = i.votes ?? [];
  return {
    id: i.id,
    kind: i.kind,
    title: i.title,
    description: i.description,
    link: i.link,
    address: i.address,
    menuUrl: i.menuUrl ?? '',
    cost: i.cost,
    imageUrl: i.imageUrl ?? '',
    siteName: i.siteName ?? '',
    details: i.details ?? [],
    suggestedBy: memberView(i.suggestedBy),
    voteCount: votes.length,
    voters: votes.map((v) => memberView(v.member)),
    votedByMe: votes.some((v) => v.memberId === meId),
    commentCount,
    createdAt: new Date(i.createdAt).toISOString(),
  };
};

export const itineraryEntryView = (e: ItineraryEntry): ItineraryEntryView => ({
  id: e.id,
  date: e.date,
  startTime: e.startTime,
  title: e.title,
  notes: e.notes,
  position: e.position,
  ideaId: e.ideaId,
  idea: e.idea
    ? {
        id: e.idea.id,
        kind: e.idea.kind,
        title: e.idea.title,
        link: e.idea.link,
        address: e.idea.address,
        imageUrl: e.idea.imageUrl ?? '',
      }
    : null,
  addedBy: memberView(e.addedBy),
});

export interface CommentView {
  id: string;
  ideaId: string;
  body: string;
  member: MemberView;
  createdAt: string;
}

export interface PostView {
  id: string;
  body: string;
  member: MemberView;
  reactions: {
    emoji: string;
    count: number;
    memberIds: string[];
    mine: boolean;
  }[];
  createdAt: string;
}

export interface ActivityView {
  id: string;
  type: Activity['type'];
  message: string;
  member: MemberView;
  refKind: Activity['refKind'];
  refId: string | null;
  createdAt: string;
}

export const commentView = (c: Comment): CommentView => ({
  id: c.id,
  ideaId: c.ideaId,
  body: c.body,
  member: memberView(c.member),
  createdAt: new Date(c.createdAt).toISOString(),
});

export const postView = (p: Post, meId: string): PostView => ({
  id: p.id,
  body: p.body,
  member: memberView(p.member),
  reactions: Object.entries(p.reactions ?? {})
    .filter(([, ids]) => ids.length > 0)
    .map(([emoji, memberIds]) => ({
      emoji,
      count: memberIds.length,
      memberIds,
      mine: memberIds.includes(meId),
    })),
  createdAt: new Date(p.createdAt).toISOString(),
});

export const activityView = (a: Activity): ActivityView => ({
  id: a.id,
  type: a.type,
  message: a.message,
  member: memberView(a.member),
  refKind: a.refKind,
  refId: a.refId,
  createdAt: new Date(a.createdAt).toISOString(),
});

export interface PhotoView {
  id: string;
  caption: string;
  originalName: string;
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  hasThumb: boolean;
  hasPreview: boolean;
  urls: { original: string; thumb: string | null; preview: string | null };
  uploadedBy: MemberView;
  commentCount: number;
  createdAt: string;
}

export interface PhotoCommentView {
  id: string;
  photoId: string;
  body: string;
  member: MemberView;
  createdAt: string;
}

export const photoView = (p: Photo, commentCount = 0): PhotoView => ({
  id: p.id,
  caption: p.caption,
  originalName: p.originalName,
  mimeType: p.mimeType,
  bytes: p.bytes,
  width: p.width,
  height: p.height,
  hasThumb: p.hasThumb,
  hasPreview: p.hasPreview,
  urls: {
    original: `/api/photo-files/${p.id}/original`,
    thumb: p.hasThumb ? `/api/photo-files/${p.id}/thumb` : null,
    preview: p.hasPreview ? `/api/photo-files/${p.id}/preview` : null,
  },
  uploadedBy: memberView(p.member),
  commentCount,
  createdAt: new Date(p.createdAt).toISOString(),
});

export const photoCommentView = (c: PhotoComment): PhotoCommentView => ({
  id: c.id,
  photoId: c.photoId,
  body: c.body,
  member: memberView(c.member),
  createdAt: new Date(c.createdAt).toISOString(),
});

export interface NotificationView {
  id: string;
  type: Notification['type'];
  message: string;
  actor: MemberView;
  refKind: Notification['refKind'];
  refId: string | null;
  url: string;
  read: boolean;
  createdAt: string;
}

export const notificationView = (n: Notification): NotificationView => ({
  id: n.id,
  type: n.type,
  message: n.message,
  actor: memberView(n.actor),
  refKind: n.refKind,
  refId: n.refId,
  url: refUrl(n.refKind, n.refId),
  read: n.readAt !== null,
  createdAt: new Date(n.createdAt).toISOString(),
});
