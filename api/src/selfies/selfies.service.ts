import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Not } from 'typeorm';
import {
  Idea,
  ItineraryEntry,
  Member,
  Photo,
  SELFIE_FIRST_BONUS,
  SelfieChallenge,
  SelfieDifficulty,
  SelfieEntry,
  Trip,
} from '../entities';
import { ActivityService } from '../activity/activity.service';
import { AiService } from '../ai/ai.service';
import { MemberView, memberView, photoView } from '../common/serializers';
import { shiftDays, tripToday } from '../location/location.service';
import { PhotosService, UploadedFiles } from '../photos/photos.service';
import { UploadPhotoDto } from '../photos/photos.dto';
import {
  buildList,
  builtInReplacement,
  ChallengeIdea,
  ChallengeList,
  ChallengeListSchema,
  COMMENT_MAX,
  isRepeat,
  Judgement,
  JudgementSchema,
  JUDGE_SYSTEM,
  LIST_SYSTEM,
  OneChallenge,
  OneChallengeSchema,
  ONE_SYSTEM,
  pointsFor,
  renderJudge,
  renderReplace,
  renderTrip,
  sanitizeIdea,
  TripContext,
} from './selfie.ai';

/**
 * off: switched off, or not a trip. before: the trip hasn't come round yet.
 * preparing: another phone is having the list written right now.
 * open: selfies can be uploaded. closed: the trip is over; results only.
 */
export type GameStatus = 'off' | 'before' | 'preparing' | 'open' | 'closed';

export interface EntryView {
  id: string;
  challengeId: string;
  status: SelfieEntry['status'];
  judgedBy: SelfieEntry['judgedBy'];
  comment: string;
  points: number;
  bonus: number;
  member: MemberView;
  photo: { id: string; thumb: string; preview: string; original: string };
  createdAt: string;
}

export interface ChallengeView {
  id: string;
  title: string;
  hint: string;
  difficulty: SelfieDifficulty;
  points: number;
  source: SelfieChallenge['source'];
  /** Everyone whose selfie counted, first to finish first. */
  done: EntryView[];
  /** The caller's own latest result: counted, or the one that didn't. */
  mine: EntryView | null;
  myRejected: EntryView | null;
  /** Organizer only: selfies the AI turned down, to overrule if they should count. */
  rejected: EntryView[];
}

export interface ScoreRow {
  member: MemberView;
  points: number;
  done: number;
  rank: number;
}

export interface GameView {
  status: GameStatus;
  /** The organizer can edit the list and overrule the judge. */
  canManage: boolean;
  challenges: ChallengeView[];
  scoreboard: ScoreRow[];
  me: { points: number; done: number; rank: number | null };
  total: number;
  /** Set once the trip is over and somebody scored. */
  winner: ScoreRow | null;
}

export interface SubmitResult {
  entry: EntryView;
  /** True when an earlier selfie of theirs still counts for this challenge. */
  earlierStillCounts: boolean;
  game: GameView;
}

/** A day of slack either side, as the family map has, so no time zone is cut short. */
function windowOf(trip: Trip, now = new Date()): 'before' | 'open' | 'closed' {
  const today = tripToday(trip, now) ?? now.toISOString().slice(0, 10);
  if (today < shiftDays(trip.startDate, -1)) return 'before';
  if (today > shiftDays(trip.endDate, 1)) return 'closed';
  return 'open';
}

const entryView = (e: SelfieEntry): EntryView => {
  const p = photoView(e.photo);
  return {
    id: e.id,
    challengeId: e.challengeId,
    status: e.status,
    judgedBy: e.judgedBy,
    comment: e.comment,
    points: e.points,
    bonus: e.bonus,
    member: memberView(e.member),
    photo: {
      id: e.photoId,
      thumb: p.urls.thumb ?? p.urls.preview ?? p.urls.original,
      preview: p.urls.preview ?? p.urls.original,
      original: p.urls.original,
    },
    createdAt: new Date(e.createdAt).toISOString(),
  };
};

@Injectable()
export class SelfiesService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly ai: AiService,
    private readonly photos: PhotosService,
    private readonly activity: ActivityService,
  ) {}

  // ---------- reading ----------

  private statusOf(trip: Trip, now = new Date()): GameStatus {
    if (trip.kind === 'gathering' || trip.selfieGame === 'off') return 'off';
    return windowOf(trip, now);
  }

  /** The whole game as one person sees it. Writes the list the first time it's needed. */
  async view(me: Member, now = new Date()): Promise<GameView> {
    const trip = me.trip;
    let status = this.statusOf(trip, now);
    if (status === 'open' && !(await this.ensureList(trip)))
      status = 'preparing';
    return this.build(me, status);
  }

  private async build(me: Member, status: GameStatus): Promise<GameView> {
    const m = this.ds.manager;
    const tripId = me.tripId;
    const visible = status === 'open' || status === 'closed';
    const [challenges, entries] = visible
      ? await Promise.all([
          m.find(SelfieChallenge, {
            where: { tripId, retiredAt: IsNull() },
            order: { position: 'ASC', createdAt: 'ASC' },
          }),
          m.find(SelfieEntry, {
            where: { tripId },
            order: { createdAt: 'ASC' },
          }),
        ])
      : [[], []];
    const approved = entries.filter((e) => e.status === 'approved');

    // Points count even for challenges later retired.
    const rows = new Map<
      string,
      { member: Member; points: number; done: number; last: number }
    >();
    for (const e of approved) {
      const r = rows.get(e.memberId) ?? {
        member: e.member,
        points: 0,
        done: 0,
        last: 0,
      };
      r.points += e.points + e.bonus;
      r.done += 1;
      r.last = Math.max(r.last, e.createdAt);
      rows.set(e.memberId, r);
    }
    // Most points first; level on points, whoever got there first.
    const scoreboard: ScoreRow[] = [...rows.values()]
      .sort((a, b) => b.points - a.points || a.last - b.last)
      .map((r, i) => ({
        member: memberView(r.member),
        points: r.points,
        done: r.done,
        rank: i + 1,
      }));
    const mine = scoreboard.find((r) => r.member.id === me.id);

    return {
      status,
      canManage: me.isOwner,
      challenges: challenges.map((c) => {
        const forThis = entries.filter((e) => e.challengeId === c.id);
        const myApproved = forThis.find(
          (e) => e.memberId === me.id && e.status === 'approved',
        );
        const myRejected = forThis.find(
          (e) => e.memberId === me.id && e.status === 'rejected',
        );
        return {
          id: c.id,
          title: c.title,
          hint: c.hint,
          difficulty: c.difficulty,
          points: c.points,
          source: c.source,
          done: forThis.filter((e) => e.status === 'approved').map(entryView),
          mine: myApproved ? entryView(myApproved) : null,
          myRejected: myRejected ? entryView(myRejected) : null,
          rejected: me.isOwner
            ? forThis.filter((e) => e.status === 'rejected').map(entryView)
            : [],
        };
      }),
      scoreboard,
      me: {
        points: mine?.points ?? 0,
        done: mine?.done ?? 0,
        rank: mine?.rank ?? null,
      },
      total: challenges.length,
      winner: status === 'closed' ? (scoreboard[0] ?? null) : null,
    };
  }

  // ---------- the list ----------

  private async context(trip: Trip): Promise<TripContext> {
    const m = this.ds.manager;
    const [plan, ideas] = await Promise.all([
      m.find(ItineraryEntry, {
        where: { tripId: trip.id },
        order: { date: 'ASC', position: 'ASC' },
        take: 30,
      }),
      m.find(Idea, { where: { tripId: trip.id }, relations: { votes: true } }),
    ]);
    return {
      name: trip.name,
      destination: trip.destination,
      stayName: trip.lodging?.name ?? '',
      stayAddress: trip.lodging?.address ?? '',
      startDate: trip.startDate,
      endDate: trip.endDate,
      plan: plan.map((p) => p.title).filter(Boolean),
      ideas: ideas
        .sort((a, b) => (b.votes?.length ?? 0) - (a.votes?.length ?? 0))
        .map((i) => i.title),
    };
  }

  /**
   * Make sure the trip has its list. Only one caller writes it; anyone else
   * arriving meanwhile is told it's being prepared. False = not ready yet.
   */
  private async ensureList(trip: Trip): Promise<boolean> {
    const has = await this.ds.manager.exists(SelfieChallenge, {
      where: { tripId: trip.id },
    });
    if (has) return true;
    return this.ds.transaction(async (m) => {
      const lock = await m.query<{ got: boolean }[]>(
        `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS got`,
        [`selfie-list:${trip.id}`],
      );
      if (!lock[0]?.got) return false;
      if (await m.exists(SelfieChallenge, { where: { tripId: trip.id } }))
        return true;
      await this.writeList(m, trip);
      return true;
    });
  }

  private async writeList(m: EntityManager, trip: Trip): Promise<void> {
    const ai = await this.ai.structured<ChallengeList>(trip.id, {
      task: 'selfie-list',
      system: LIST_SYSTEM,
      user: renderTrip(await this.context(trip)),
      schema: ChallengeListSchema,
      maxTokens: 1500,
    });
    const ideas = buildList(ai);
    await m.save(
      SelfieChallenge,
      ideas.map((idea, i) =>
        m.create(SelfieChallenge, {
          tripId: trip.id,
          position: i,
          title: idea.title,
          hint: idea.hint,
          difficulty: idea.difficulty,
          points: pointsFor(idea.difficulty),
          source: idea.source,
          retiredAt: null,
        }),
      ),
    );
  }

  // ---------- organizer ----------

  private assertOrganizer(me: Member) {
    if (!me.isOwner)
      throw new ForbiddenException(
        'Only the organizer can change the selfie game',
      );
  }

  private assertTrip(me: Member) {
    if (me.trip.kind === 'gathering')
      throw new ConflictException("Gatherings don't have a selfie game.");
  }

  private async challenge(
    m: EntityManager,
    tripId: string,
    id: string,
  ): Promise<SelfieChallenge> {
    const c = await m.findOne(SelfieChallenge, {
      where: { id, tripId, retiredAt: IsNull() },
    });
    if (!c)
      throw new NotFoundException('That challenge is no longer on the list');
    return c;
  }

  async setOn(me: Member, on: boolean): Promise<GameView> {
    this.assertOrganizer(me);
    this.assertTrip(me);
    await this.ds.manager.update(
      Trip,
      { id: me.tripId },
      { selfieGame: on ? 'on' : 'off' },
    );
    me.trip.selfieGame = on ? 'on' : 'off';
    return this.view(me);
  }

  async addChallenge(
    me: Member,
    input: { title: string; hint?: string; difficulty: SelfieDifficulty },
  ): Promise<GameView> {
    this.assertOrganizer(me);
    this.assertTrip(me);
    const idea = sanitizeIdea(input, input.difficulty);
    if (!idea) throw new BadRequestException('Give the challenge a few words');
    const m = this.ds.manager;
    const active = await m.find(SelfieChallenge, {
      where: { tripId: me.tripId, retiredAt: IsNull() },
    });
    if (active.length >= 25)
      throw new BadRequestException(
        'That is plenty of challenges for one trip',
      );
    if (
      isRepeat(
        idea.title,
        active.map((c) => c.title),
      )
    )
      throw new BadRequestException('That one is already on the list');
    await m.save(
      SelfieChallenge,
      m.create(SelfieChallenge, {
        tripId: me.tripId,
        position: Math.max(-1, ...active.map((c) => c.position)) + 1,
        title: idea.title,
        hint: idea.hint,
        difficulty: idea.difficulty,
        points: pointsFor(idea.difficulty),
        source: 'custom',
        retiredAt: null,
      }),
    );
    return this.view(me);
  }

  async editChallenge(
    me: Member,
    id: string,
    input: { title?: string; hint?: string; difficulty?: SelfieDifficulty },
  ): Promise<GameView> {
    this.assertOrganizer(me);
    const m = this.ds.manager;
    const c = await this.challenge(m, me.tripId, id);
    const idea = sanitizeIdea(
      {
        title: input.title ?? c.title,
        hint: input.hint ?? c.hint,
        difficulty: input.difficulty ?? c.difficulty,
      },
      c.difficulty,
    );
    if (!idea) throw new BadRequestException('Give the challenge a few words');
    const changed = idea.title !== c.title || idea.hint !== c.hint;
    await m.update(
      SelfieChallenge,
      { id: c.id },
      {
        title: idea.title,
        hint: idea.hint,
        difficulty: idea.difficulty,
        points: pointsFor(idea.difficulty),
        source: changed ? 'custom' : c.source,
      },
    );
    return this.view(me);
  }

  /** Off the list. Selfies that already scored against it keep their points. */
  async removeChallenge(me: Member, id: string): Promise<GameView> {
    this.assertOrganizer(me);
    const m = this.ds.manager;
    const c = await this.challenge(m, me.tripId, id);
    await this.retire(m, c);
    return this.view(me);
  }

  private async retire(m: EntityManager, c: SelfieChallenge): Promise<void> {
    const scored = await m.exists(SelfieEntry, {
      where: { challengeId: c.id, status: 'approved' },
    });
    if (scored)
      await m.update(SelfieChallenge, { id: c.id }, { retiredAt: Date.now() });
    else await m.delete(SelfieChallenge, { id: c.id });
  }

  /** Swap one challenge for a fresh AI idea of the same difficulty (built-in when the AI can't). */
  async replaceChallenge(me: Member, id: string): Promise<GameView> {
    this.assertOrganizer(me);
    this.assertTrip(me);
    const m0 = this.ds.manager;
    const old = await this.challenge(m0, me.tripId, id);
    // Everything ever on this trip's list, so a replacement never repeats an earlier one either.
    const all = await m0.find(SelfieChallenge, {
      where: { tripId: me.tripId },
    });
    const titles = all.map((c) => c.title);
    const keep = all
      .filter((c) => !c.retiredAt && c.id !== old.id)
      .map((c) => c.title);

    const ai = await this.ai.structured<OneChallenge>(me.tripId, {
      task: 'selfie-replace',
      system: ONE_SYSTEM,
      user: renderReplace(
        await this.context(me.trip),
        old.title,
        keep,
        old.difficulty,
      ),
      schema: OneChallengeSchema,
      maxTokens: 300,
    });
    let idea: ChallengeIdea | null = ai
      ? sanitizeIdea({ ...ai, difficulty: old.difficulty }, old.difficulty)
      : null;
    let source: SelfieChallenge['source'] = 'ai';
    if (!idea || isRepeat(idea.title, titles)) {
      idea = builtInReplacement(titles, old.difficulty);
      source = 'builtin';
    }
    if (!idea)
      throw new ConflictException(
        "Couldn't come up with a new one right now. Edit it yourself, or try again.",
      );
    const fresh = idea;

    await this.ds.transaction(async (m) => {
      const current = await this.challenge(m, me.tripId, id);
      await this.retire(m, current);
      await m.save(
        SelfieChallenge,
        m.create(SelfieChallenge, {
          tripId: me.tripId,
          position: current.position,
          title: fresh.title,
          hint: fresh.hint,
          // Same difficulty and points as the one it replaces.
          difficulty: current.difficulty,
          points: current.points,
          source,
          retiredAt: null,
        }),
      );
    });
    return this.view(me);
  }

  /** A whole new list, while nobody has scored yet. */
  async regenerate(me: Member): Promise<GameView> {
    this.assertOrganizer(me);
    this.assertTrip(me);
    if (this.statusOf(me.trip) !== 'open')
      throw new ConflictException(
        'The selfie game is not open for this trip right now.',
      );
    await this.ds.transaction(async (m) => {
      if (await m.exists(SelfieEntry, { where: { tripId: me.tripId } }))
        throw new ConflictException(
          'People have already added selfies. Replace challenges one at a time instead.',
        );
      await m.delete(SelfieChallenge, { tripId: me.tripId });
      await this.writeList(m, me.trip);
    });
    return this.view(me);
  }

  /** The organizer's word is final: count a selfie the AI turned down, or take one off the board. */
  async overrule(
    me: Member,
    entryId: string,
    status: 'approved' | 'rejected',
  ): Promise<GameView> {
    this.assertOrganizer(me);
    let announce: { member: Member; title: string; points: number } | null =
      null;
    await this.ds.transaction(async (m) => {
      const e = await m.findOne(SelfieEntry, {
        where: { id: entryId, tripId: me.tripId },
      });
      if (!e) throw new NotFoundException('That selfie is no longer there');
      if (e.status === status) return;
      const c = await m.findOne(SelfieChallenge, {
        where: { id: e.challengeId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!c) throw new NotFoundException('That challenge is gone');
      if (status === 'rejected') {
        await m.update(
          SelfieEntry,
          { id: e.id },
          {
            status: 'rejected',
            judgedBy: 'organizer',
            points: 0,
            bonus: 0,
            comment: 'The organizer took this one off the board.',
          },
        );
        return;
      }
      const bonus = await this.firstBonus(m, c.id, e.memberId);
      await m.delete(SelfieEntry, {
        challengeId: c.id,
        memberId: e.memberId,
        id: Not(e.id),
      });
      await m.update(
        SelfieEntry,
        { id: e.id },
        {
          status: 'approved',
          judgedBy: 'organizer',
          points: c.points,
          bonus,
          comment: 'The organizer says it counts!',
        },
      );
      announce = { member: e.member, title: c.title, points: c.points + bonus };
    });
    if (announce) await this.announce(announce);
    return this.view(me);
  }

  // ---------- playing ----------

  private async firstBonus(
    m: EntityManager,
    challengeId: string,
    memberId: string,
  ): Promise<number> {
    const others = await m
      .createQueryBuilder(SelfieEntry, 'e')
      .where('e.challengeId = :challengeId', { challengeId })
      .andWhere('e.status = :s', { s: 'approved' })
      .andWhere('e.memberId <> :memberId', { memberId })
      .getCount();
    return others ? 0 : SELFIE_FIRST_BONUS;
  }

  private async announce(a: { member: Member; title: string; points: number }) {
    const member = await this.ds.manager.findOne(Member, {
      where: { id: a.member.id },
      relations: { trip: true },
    });
    if (!member) return;
    await this.activity.record(
      member,
      'selfie',
      `completed "${a.title}" (+${a.points})`,
      { kind: 'selfie', id: member.tripId },
    );
  }

  /** Upload a selfie for a challenge: into the album, past the judge, onto the board. */
  async submit(
    me: Member,
    challengeId: string,
    files: UploadedFiles | undefined,
    dto: UploadPhotoDto,
  ): Promise<SubmitResult> {
    const stagedPaths = [
      files?.original?.[0],
      files?.thumb?.[0],
      files?.preview?.[0],
    ].filter(Boolean);
    this.assertTrip(me);
    const status = this.statusOf(me.trip);
    let challenge: SelfieChallenge | null = null;
    if (status === 'open')
      challenge = await this.ds.manager.findOne(SelfieChallenge, {
        where: { id: challengeId, tripId: me.tripId, retiredAt: IsNull() },
      });
    if (status !== 'open' || !challenge) {
      // Nothing was stored: clear the staged files (PhotosService does this on its own path).
      await this.photos.discard(stagedPaths.map((f) => f!.path));
      if (status !== 'open')
        throw new ConflictException(
          status === 'closed'
            ? 'The selfie game is over for this trip.'
            : status === 'off'
              ? 'The selfie game is switched off for this trip.'
              : 'The selfie game opens when the trip starts.',
        );
      throw new NotFoundException('That challenge is no longer on the list');
    }

    const photo = await this.photos.store(me.tripId, me, files, {
      ...dto,
      caption: `🤳 ${challenge.title}`,
    });
    const verdict = await this.judge(me.tripId, challenge, photo);

    let entryId = '';
    let earlierStillCounts = false;
    let announce: { member: Member; title: string; points: number } | null =
      null;
    await this.ds.transaction(async (m) => {
      const c = await m.findOne(SelfieChallenge, {
        where: { id: challenge.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!c)
        throw new NotFoundException('That challenge is no longer on the list');
      const mine = await m.find(SelfieEntry, {
        where: { challengeId: c.id, memberId: me.id },
      });
      const before = mine.find((e) => e.status === 'approved');
      if (verdict.match) {
        // A retake that counts replaces the earlier selfie and keeps its first-finisher bonus.
        const bonus = before
          ? before.bonus
          : await this.firstBonus(m, c.id, me.id);
        if (mine.length)
          await m.delete(SelfieEntry, { challengeId: c.id, memberId: me.id });
        const saved = await m.save(
          SelfieEntry,
          m.create(SelfieEntry, {
            challengeId: c.id,
            tripId: me.tripId,
            memberId: me.id,
            photoId: photo.id,
            status: 'approved',
            judgedBy: verdict.by,
            comment: verdict.comment,
            points: c.points,
            bonus,
          }),
        );
        entryId = saved.id;
        if (!before)
          announce = { member: me, title: c.title, points: c.points + bonus };
      } else {
        // Didn't count. An earlier selfie that did is left alone.
        const old = mine
          .filter((e) => e.status === 'rejected')
          .map((e) => e.id);
        if (old.length) await m.delete(SelfieEntry, old);
        const saved = await m.save(
          SelfieEntry,
          m.create(SelfieEntry, {
            challengeId: c.id,
            tripId: me.tripId,
            memberId: me.id,
            photoId: photo.id,
            status: 'rejected',
            judgedBy: 'ai',
            comment: verdict.comment,
            points: 0,
            bonus: 0,
          }),
        );
        entryId = saved.id;
        earlierStillCounts = !!before;
      }
    });
    if (announce) await this.announce(announce);
    const entry = await this.ds.manager.findOneOrFail(SelfieEntry, {
      where: { id: entryId },
    });
    return {
      entry: entryView(entry),
      earlierStillCounts,
      game: await this.build(me, 'open'),
    };
  }

  /** The AI looks at a small copy. If it can't (off, slow, over the daily limit), the selfie counts. */
  private async judge(
    tripId: string,
    challenge: SelfieChallenge,
    photo: Photo,
  ): Promise<{ match: boolean; comment: string; by: 'ai' | 'honor' }> {
    const honor = { match: true, comment: '', by: 'honor' as const };
    const copy = await this.photos.smallCopy(photo);
    if (!copy) return honor;
    const res = await this.ai.structured<Judgement>(tripId, {
      task: 'selfie-judge',
      system: JUDGE_SYSTEM,
      user: renderJudge(challenge.title, challenge.hint),
      schema: JudgementSchema,
      image: {
        base64: copy.bytes.toString('base64'),
        mediaType: copy.mediaType,
      },
      maxTokens: 200,
    });
    if (!res || typeof res.match !== 'boolean') return honor;
    const comment =
      typeof res.comment === 'string'
        ? res.comment.replace(/\s+/g, ' ').trim().slice(0, COMMENT_MAX)
        : '';
    return {
      match: res.match,
      comment:
        comment ||
        (res.match
          ? ''
          : "That one doesn't look like it matches. Try another shot!"),
      by: 'ai',
    };
  }
}
