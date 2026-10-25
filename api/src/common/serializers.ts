import {
  Activity,
  Comment,
  Idea,
  ItineraryEntry,
  Member,
  Post,
  Trip,
} from '../entities';

export interface MemberView {
  id: string;
  name: string;
  isOwner: boolean;
  emoji: string;
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
  cost: Idea['cost'];
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
  idea: Pick<IdeaView, 'id' | 'kind' | 'title' | 'link' | 'address'> | null;
  addedBy: MemberView;
}

export const memberView = (m: Member): MemberView => ({
  id: m.id,
  name: m.name,
  isOwner: m.isOwner,
  emoji: m.emoji ?? '',
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
    cost: i.cost,
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
