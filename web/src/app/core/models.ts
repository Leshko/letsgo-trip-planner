export interface Member {
  id: string;
  name: string;
  isOwner: boolean;
  emoji: string;
}

export interface Lodging {
  name: string;
  address: string;
  checkIn: string;
  checkOut: string;
  link: string;
  notes: string;
  photos: string[];
}

export interface Trip {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  inviteCode: string;
  lodging: Lodging;
  members: Member[];
  createdAt: string;
}

export interface Session {
  token: string;
  member: Member;
  trip: Trip;
}

export type IdeaKind = 'activity' | 'food';
export type CostLevel = '' | 'free' | '$' | '$$' | '$$$';

export interface Idea {
  id: string;
  kind: IdeaKind;
  title: string;
  description: string;
  link: string;
  address: string;
  cost: CostLevel;
  suggestedBy: Member;
  voteCount: number;
  voters: Member[];
  votedByMe: boolean;
  commentCount: number;
  createdAt: string;
}

export interface Comment {
  id: string;
  ideaId: string;
  body: string;
  member: Member;
  createdAt: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  memberIds: string[];
  mine: boolean;
}

export interface Post {
  id: string;
  body: string;
  member: Member;
  reactions: Reaction[];
  createdAt: string;
}

export interface Activity {
  id: string;
  type: 'joined' | 'idea' | 'vote' | 'comment' | 'itinerary' | 'lodging' | 'trip';
  message: string;
  member: Member;
  refKind: 'idea' | 'itinerary' | 'lodging' | null;
  refId: string | null;
  createdAt: string;
}

export interface ItineraryEntry {
  id: string;
  date: string;
  startTime: string;
  title: string;
  notes: string;
  position: number;
  ideaId: string | null;
  idea: Pick<Idea, 'id' | 'kind' | 'title' | 'link' | 'address'> | null;
  addedBy: Member;
}

export interface ItineraryDay {
  date: string;
  entries: ItineraryEntry[];
}
