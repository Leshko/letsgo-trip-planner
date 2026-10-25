import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Comment, Idea, Member, Post } from '../entities';
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
  ): Promise<PostView> {
    const saved = await this.posts.save(
      this.posts.create({
        tripId,
        memberId: me.id,
        body: body.trim(),
        reactions: {},
      }),
    );
    return postView(await this.loadPost(tripId, saved.id), me.id);
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
    const p = await this.loadPost(tripId, postId);
    const ids = new Set(p.reactions[emoji] ?? []);
    if (ids.has(me.id)) ids.delete(me.id);
    else ids.add(me.id);
    p.reactions = { ...p.reactions, [emoji]: [...ids] };
    await this.posts.save(p);
    return postView(await this.loadPost(tripId, postId), me.id);
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
    await this.activity.record(me, 'comment', `commented on ${idea.title}`, {
      kind: 'idea',
      id: idea.id,
    });
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
