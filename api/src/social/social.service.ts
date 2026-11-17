import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { Comment, Idea, Member, PollData, Post } from '../entities';
import { POLL_MAX_OPTIONS, POLL_OPTION_MAX } from './social.dto';
import {
  commentView,
  CommentView,
  postView,
  PostView,
} from '../common/serializers';
import { ActivityService } from '../activity/activity.service';

@Injectable()
export class SocialService {
  constructor(
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    @InjectRepository(Comment) private readonly comments: Repository<Comment>,
    @InjectRepository(Idea) private readonly ideas: Repository<Idea>,
    private readonly activity: ActivityService,
  ) {}

  // ---- wall ----

  async listPosts(tripId: string, me: Member): Promise<PostView[]> {
    const rows = await this.posts.find({
      where: { tripId },
      order: { createdAt: 'DESC' },
      take: 200,
    });
    return rows.map((p) => postView(p, me.id));
  }

  async createPost(
    tripId: string,
    me: Member,
    body: string,
    pollInput?: { options: string[]; multiple?: boolean },
  ): Promise<PostView> {
    const poll = pollInput ? newPoll(pollInput) : null;
    const saved = await this.posts.save(
      this.posts.create({
        tripId,
        memberId: me.id,
        body: body.trim(),
        reactions: {},
        poll,
      }),
    );
    await this.activity.record(
      me,
      'post',
      poll
        ? `started a poll: "${snippetOf(body)}"`
        : `posted on the wall: "${snippetOf(body)}"`,
      { kind: poll ? 'poll' : 'post', id: saved.id },
    );
    return postView(await this.loadPost(tripId, saved.id), me.id);
  }

  async getPost(tripId: string, me: Member, postId: string): Promise<PostView> {
    return postView(await this.loadPost(tripId, postId), me.id);
  }

  /**
   * Change a post's stored reactions or poll votes. The row is locked for the
   * change, so two people tapping at the same moment both count.
   */
  private async change(
    tripId: string,
    postId: string,
    fn: (p: Post) => void,
  ): Promise<Post> {
    await this.posts.manager.transaction(async (m) => {
      const p = await m.findOne(Post, {
        where: { id: postId, tripId },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false,
      });
      if (!p) throw new NotFoundException('Post not found');
      fn(p);
      await m.update(
        Post,
        { id: p.id },
        { reactions: p.reactions, poll: p.poll },
      );
    });
    return this.loadPost(tripId, postId);
  }

  /** Tap an option. One-answer polls move the vote; tapping your own answer takes it back. */
  async votePoll(
    tripId: string,
    me: Member,
    postId: string,
    optionId: string,
  ): Promise<PostView> {
    let added = false;
    const p = await this.change(tripId, postId, (post) => {
      const poll = post.poll;
      if (!poll) throw new BadRequestException("That post isn't a poll");
      if (poll.closed) throw new ConflictException('Voting is closed');
      const option = poll.options.find((o) => o.id === optionId);
      if (!option) throw new NotFoundException('That option is gone');
      const had = option.votes.includes(me.id);
      if (!poll.multiple)
        for (const o of poll.options)
          o.votes = o.votes.filter((id) => id !== me.id);
      if (had) option.votes = option.votes.filter((id) => id !== me.id);
      else {
        option.votes = [...option.votes, me.id];
        added = true;
      }
      post.poll = { ...poll, options: poll.options.map((o) => ({ ...o })) };
    });
    if (added && p.memberId !== me.id)
      await this.activity.record(
        me,
        'vote',
        `voted on your poll: "${snippetOf(p.body)}"`,
        { kind: 'poll', id: p.id },
        [p.memberId],
      );
    return postView(p, me.id);
  }

  async setPollClosed(
    tripId: string,
    me: Member,
    postId: string,
    closed: boolean,
  ): Promise<PostView> {
    const existing = await this.loadPost(tripId, postId);
    if (!existing.poll) throw new BadRequestException("That post isn't a poll");
    if (existing.memberId !== me.id && !me.isOwner)
      throw new ForbiddenException(
        'Only the person who started the poll or the organizer can do that',
      );
    const p = await this.change(tripId, postId, (post) => {
      if (post.poll) post.poll = { ...post.poll, closed };
    });
    return postView(p, me.id);
  }

  private async loadPost(tripId: string, id: string): Promise<Post> {
    const p = await this.posts.findOne({ where: { id, tripId } });
    if (!p) throw new NotFoundException('Post not found');
    return p;
  }

  async toggleReaction(
    tripId: string,
    me: Member,
    postId: string,
    emoji: string,
  ): Promise<PostView> {
    const p = await this.change(tripId, postId, (post) => {
      const ids = new Set(post.reactions[emoji] ?? []);
      if (ids.has(me.id)) ids.delete(me.id);
      else ids.add(me.id);
      post.reactions = { ...post.reactions, [emoji]: [...ids] };
    });
    return postView(p, me.id);
  }

  async deletePost(tripId: string, me: Member, postId: string): Promise<void> {
    const p = await this.loadPost(tripId, postId);
    if (p.memberId !== me.id && !me.isOwner)
      throw new ForbiddenException(
        'Only the author or trip owner can delete this',
      );
    await this.posts.remove(p);
  }

  // ---- comments on ideas ----

  private async assertIdea(tripId: string, ideaId: string): Promise<Idea> {
    const idea = await this.ideas.findOne({ where: { id: ideaId, tripId } });
    if (!idea) throw new NotFoundException('Idea not found');
    return idea;
  }

  async listComments(tripId: string, ideaId: string): Promise<CommentView[]> {
    await this.assertIdea(tripId, ideaId);
    const rows = await this.comments.find({
      where: { tripId, ideaId },
      order: { createdAt: 'ASC' },
    });
    return rows.map(commentView);
  }

  async addComment(
    tripId: string,
    me: Member,
    ideaId: string,
    body: string,
  ): Promise<CommentView> {
    const idea = await this.assertIdea(tripId, ideaId);
    const saved = await this.comments.save(
      this.comments.create({
        tripId,
        ideaId,
        memberId: me.id,
        body: body.trim(),
      }),
    );
    const others = await this.comments.find({
      where: { ideaId },
      select: { memberId: true },
    });
    await this.activity.record(
      me,
      'comment',
      `commented on ${idea.title}`,
      {
        kind: 'idea',
        id: idea.id,
      },
      [idea.suggestedById, ...others.map((c) => c.memberId)],
    );
    const row = await this.comments.findOneOrFail({ where: { id: saved.id } });
    return commentView(row);
  }

  async deleteComment(
    tripId: string,
    me: Member,
    commentId: string,
  ): Promise<void> {
    const c = await this.comments.findOne({ where: { id: commentId, tripId } });
    if (!c) throw new NotFoundException('Comment not found');
    if (c.memberId !== me.id && !me.isOwner)
      throw new ForbiddenException(
        'Only the author or trip owner can delete this',
      );
    await this.comments.remove(c);
  }

  async commentCounts(tripId: string): Promise<Map<string, number>> {
    const rows = await this.comments
      .createQueryBuilder('c')
      .select('c.ideaId', 'ideaId')
      .addSelect('COUNT(*)', 'n')
      .where('c.tripId = :tripId', { tripId })
      .groupBy('c.ideaId')
      .getRawMany<{ ideaId: string; n: string | number }>();
    return new Map(rows.map((r) => [r.ideaId, Number(r.n)]));
  }
}

function snippetOf(body: string): string {
  const s = body.trim().replace(/\s+/g, ' ');
  return s.length > 60 ? s.slice(0, 60) + '…' : s;
}

/** Clean up the options someone typed: trimmed, no blanks, no repeats. */
export function newPoll(input: {
  options: string[];
  multiple?: boolean;
}): PollData {
  const seen = new Set<string>();
  const options: PollData['options'] = [];
  for (const raw of input.options) {
    const text = raw.trim().replace(/\s+/g, ' ').slice(0, POLL_OPTION_MAX);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    options.push({ id: randomUUID().slice(0, 8), text, votes: [] });
  }
  if (options.length < 2)
    throw new BadRequestException(
      'A poll needs at least two different options',
    );
  if (options.length > POLL_MAX_OPTIONS)
    throw new BadRequestException(
      `A poll can have up to ${POLL_MAX_OPTIONS} options`,
    );
  return { multiple: !!input.multiple, closed: false, options };
}
