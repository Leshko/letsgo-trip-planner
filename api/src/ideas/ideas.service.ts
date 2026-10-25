import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Comment, Idea, IdeaKind, Member, Vote } from '../entities';
import { ActivityService } from '../activity/activity.service';
import { ideaView, IdeaView } from '../common/serializers';
import { CreateIdeaDto, UpdateIdeaDto } from './ideas.dto';

@Injectable()
export class IdeasService {
  constructor(
    @InjectRepository(Idea) private readonly ideas: Repository<Idea>,
    @InjectRepository(Vote) private readonly votes: Repository<Vote>,
    @InjectRepository(Comment) private readonly comments: Repository<Comment>,
    private readonly activity: ActivityService,
  ) {}

  private async commentCounts(tripId: string): Promise<Map<string, number>> {
    const rows = await this.comments
      .createQueryBuilder('c')
      .select('c.ideaId', 'ideaId')
      .addSelect('COUNT(*)', 'n')
      .where('c.tripId = :tripId', { tripId })
      .groupBy('c.ideaId')
      .getRawMany<{ ideaId: string; n: string | number }>();
    return new Map(rows.map((r) => [r.ideaId, Number(r.n)]));
  }

  private async commentCount(ideaId: string): Promise<number> {
    return this.comments.count({ where: { ideaId } });
  }

  async list(tripId: string, me: Member, kind?: IdeaKind): Promise<IdeaView[]> {
    const rows = await this.ideas.find({
      where: kind ? { tripId, kind } : { tripId },
      order: { createdAt: 'ASC' },
    });
    const counts = await this.commentCounts(tripId);
    // Most-voted first; ties fall back to oldest suggestion so the order is stable.
    return rows
      .map((i) => ideaView(i, me.id, counts.get(i.id) ?? 0))
      .sort(
        (a, b) =>
          b.voteCount - a.voteCount || a.createdAt.localeCompare(b.createdAt),
      );
  }

  private async load(tripId: string, ideaId: string): Promise<Idea> {
    const idea = await this.ideas.findOne({ where: { id: ideaId, tripId } });
    if (!idea) throw new NotFoundException('Idea not found');
    return idea;
  }

  async create(
    tripId: string,
    me: Member,
    dto: CreateIdeaDto,
  ): Promise<IdeaView> {
    const saved = await this.ideas.save(
      this.ideas.create({
        tripId,
        kind: dto.kind,
        title: dto.title.trim(),
        description: (dto.description ?? '').trim(),
        link: (dto.link ?? '').trim(),
        address: (dto.address ?? '').trim(),
        cost: dto.cost ?? '',
        suggestedById: me.id,
      }),
    );
    // The suggester is implicitly in favour of their own idea.
    await this.votes.save(
      this.votes.create({ ideaId: saved.id, memberId: me.id }),
    );
    await this.activity.record(
      me,
      'idea',
      `${dto.kind === 'food' ? 'wants to eat at' : 'suggested'} ${saved.title}`,
      { kind: 'idea', id: saved.id },
    );
    return ideaView(await this.load(tripId, saved.id), me.id);
  }

  async update(
    tripId: string,
    me: Member,
    ideaId: string,
    dto: UpdateIdeaDto,
  ): Promise<IdeaView> {
    const idea = await this.load(tripId, ideaId);
    if (dto.title !== undefined) idea.title = dto.title.trim();
    if (dto.description !== undefined)
      idea.description = dto.description.trim();
    if (dto.link !== undefined) idea.link = dto.link.trim();
    if (dto.address !== undefined) idea.address = dto.address.trim();
    if (dto.cost !== undefined) idea.cost = dto.cost;
    await this.ideas.save(idea);
    return ideaView(
      await this.load(tripId, ideaId),
      me.id,
      await this.commentCount(ideaId),
    );
  }

  async remove(tripId: string, me: Member, ideaId: string): Promise<void> {
    const idea = await this.load(tripId, ideaId);
    if (idea.suggestedById !== me.id && !me.isOwner) {
      throw new ForbiddenException(
        'Only the person who suggested this, or the trip owner, can remove it',
      );
    }
    await this.ideas.remove(idea);
  }

  /** Toggle the caller's vote. Returns the refreshed idea. */
  async toggleVote(
    tripId: string,
    me: Member,
    ideaId: string,
  ): Promise<IdeaView> {
    const idea = await this.load(tripId, ideaId);
    const existing = await this.votes.findOne({
      where: { ideaId, memberId: me.id },
    });
    if (existing) await this.votes.remove(existing);
    else {
      await this.votes.save(this.votes.create({ ideaId, memberId: me.id }));
      await this.activity.record(me, 'vote', `is in for ${idea.title}`, {
        kind: 'idea',
        id: idea.id,
      });
    }
    return ideaView(
      await this.load(tripId, ideaId),
      me.id,
      await this.commentCount(ideaId),
    );
  }
}
