export interface Member {
  id: string;
  name: string;
  isOwner: boolean;
  emoji: string;
  avatarUrl: string;
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

export interface IdeaDetail {
  label: string;
  value: string;
}

export interface Idea {
  id: string;
  kind: IdeaKind;
  title: string;
  description: string;
  link: string;
  address: string;
  cost: CostLevel;
  imageUrl: string;
  siteName: string;
  details: IdeaDetail[];
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
  type: 'joined' | 'idea' | 'vote' | 'comment' | 'itinerary' | 'lodging' | 'trip' | 'photo' | 'post';
  message: string;
  member: Member;
  refKind: 'idea' | 'itinerary' | 'lodging' | 'photo' | 'post' | null;
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
  idea: Pick<Idea, 'id' | 'kind' | 'title' | 'link' | 'address' | 'imageUrl'> | null;
  addedBy: Member;
}

export interface ItineraryDay {
  date: string;
  entries: ItineraryEntry[];
}

export type AiStatus = 'ok' | 'off' | 'cached' | 'capped' | 'error';

/** What the AI read off the page, already sanitized by the server. */
export interface AiPreview {
  title: string;
  kind: 'activity' | 'food' | 'other';
  summary: string;
  address: string;
  phone: string;
  hours: string;
  priceLevel: CostLevel;
  details: IdeaDetail[];
  goodFor: string;
  bookingNote: string;
  coverImage: string;
  confidence: number;
}

/** What the server pulled out of a pasted link. */
export interface Unfurled {
  url: string;
  title: string;
  description: string;
  siteName: string;
  image: string;
  images: string[];
  icon: string;
  /** Best address found on the page without AI. */
  address: string;
  ai: AiPreview | null;
  aiStatus: AiStatus;
}

export interface AiStatusInfo {
  enabled: boolean;
  model: string;
}

/** Carried across the To do / To eat switch so nothing is retyped. */
export interface FormCarry {
  kind: IdeaKind;
  form: IdeaInput;
  preview: Unfurled | null;
}

export interface TransferCode {
  code: string;
  expiresAt: number;
}

/** Everything the idea form edits; used for both create and update. */
export interface IdeaInput {
  title: string;
  description: string;
  link: string;
  address: string;
  cost: CostLevel;
  imageUrl: string;
  siteName: string;
  details: IdeaDetail[];
}

export interface Photo {
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
  uploadedBy: Member;
  commentCount: number;
  createdAt: string;
}

export interface PhotoComment {
  id: string;
  photoId: string;
  body: string;
  member: Member;
  createdAt: string;
}

export interface Notification {
  id: string;
  type: Activity['type'];
  message: string;
  actor: Member;
  refKind: Activity['refKind'];
  refId: string | null;
  url: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationPage {
  items: Notification[];
  unreadCount: number;
}

export interface NotifyPrefs {
  ideas: boolean;
  votes: boolean;
  comments: boolean;
  wall: boolean;
  plan: boolean;
  photos: boolean;
  members: boolean;
}

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  ideas: true,
  votes: true,
  comments: true,
  wall: true,
  plan: true,
  photos: true,
  members: true,
};
