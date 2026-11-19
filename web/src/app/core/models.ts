export interface Member {
  id: string;
  name: string;
  isOwner: boolean;
  emoji: string;
  avatarUrl: string;
  /** Showing their spot on the family map while the trip is on. */
  sharesLocation?: boolean;
}

export interface MemberLocation {
  member: Member;
  lat: number;
  lng: number;
  accuracy: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

export interface FamilyMap {
  /** The trip is on, so the map is open. */
  live: boolean;
  locations: MemberLocation[];
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

export type TripKind = 'trip' | 'gathering';

export interface Trip {
  id: string;
  /** A trip, or a simpler gathering (wall and photos only). Older servers leave it out. */
  kind?: TripKind;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  inviteCode: string;
  lodging: Lodging;
  members: Member[];
  createdAt: string;
}

/** A trip or gathering this phone has joined, kept so it can switch between them. */
export interface KnownTrip {
  id: string;
  kind: TripKind;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  inviteCode: string;
  memberName: string;
  token: string;
}

export interface Session {
  token: string;
  member: Member;
  trip: Trip;
  /** Whether this trip spot is saved to an account. */
  accountLinked?: boolean;
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
  /** Link to the menu, for places to eat. */
  menuUrl: string;
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

export interface PollOption {
  id: string;
  text: string;
  count: number;
  memberIds: string[];
  mine: boolean;
}

/** A poll on a wall post; the post's body is the question. */
export interface Poll {
  /** People may pick more than one option. */
  multiple: boolean;
  closed: boolean;
  /** How many different people have voted. */
  voters: number;
  options: PollOption[];
}

export interface Post {
  id: string;
  body: string;
  member: Member;
  reactions: Reaction[];
  poll?: Poll | null;
  createdAt: string;
}

export interface Activity {
  id: string;
  type: 'joined' | 'idea' | 'vote' | 'comment' | 'itinerary' | 'lodging' | 'trip' | 'photo' | 'post' | 'selfie';
  message: string;
  member: Member;
  refKind: 'idea' | 'itinerary' | 'lodging' | 'photo' | 'post' | 'poll' | 'selfie' | null;
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
  menuUrl: string;
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
  /** Best menu link found on the page without AI. */
  menuUrl: string;
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
  menuUrl: string;
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

// ---- accounts ----

export type AuthProviderId = 'google' | 'microsoft' | 'email';

export interface AccountUser {
  id: string;
  name: string;
  email: string;
  signIns: { provider: AuthProviderId; email: string }[];
}

/** One trip the signed-in account is part of, with the member token to open it. */
export interface MyTrip {
  trip: Trip;
  member: Member;
  token: string;
}

/** How a signed-in person appears in every trip and gathering. Empty name: not set up yet. */
export interface Profile {
  name: string;
  emoji: string;
  avatarUrl: string;
}

export interface Account {
  user: AccountUser;
  /** Older servers leave it out. */
  profile?: Profile;
  trips: MyTrip[];
}

export interface SignedIn {
  token: string;
  user: AccountUser;
}

export type SignInOptions = Record<AuthProviderId, boolean>;

// ---- selfie game ----

export type SelfieDifficulty = 'easy' | 'medium' | 'hard';

/** Someone's selfie for a challenge, and how it was judged. */
export interface SelfieEntry {
  id: string;
  challengeId: string;
  status: 'approved' | 'rejected';
  /** The AI looked at it, the AI wasn't available (honor system), or the organizer decided. */
  judgedBy: 'ai' | 'honor' | 'organizer';
  comment: string;
  points: number;
  bonus: number;
  member: Member;
  photo: { id: string; thumb: string; preview: string; original: string };
  createdAt: string;
}

export interface SelfieChallenge {
  id: string;
  title: string;
  hint: string;
  difficulty: SelfieDifficulty;
  points: number;
  source: 'ai' | 'builtin' | 'custom';
  /** Everyone whose selfie counted, first to finish first. */
  done: SelfieEntry[];
  mine: SelfieEntry | null;
  myRejected: SelfieEntry | null;
  /** Organizer only: selfies the AI turned down. */
  rejected: SelfieEntry[];
}

export interface SelfieScore {
  member: Member;
  points: number;
  done: number;
  rank: number;
}

export interface SelfieGame {
  /** off: switched off. before: not yet. preparing: the list is being written. open: play. closed: results. */
  status: 'off' | 'before' | 'preparing' | 'open' | 'closed';
  canManage: boolean;
  challenges: SelfieChallenge[];
  scoreboard: SelfieScore[];
  me: { points: number; done: number; rank: number | null };
  total: number;
  winner: SelfieScore | null;
}

export interface SelfieResult {
  entry: SelfieEntry;
  earlierStillCounts: boolean;
  game: SelfieGame;
}
