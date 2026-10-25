import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MemberGuard } from '../common/member.guard';
import { CurrentMember } from '../common/current-member.decorator';
import { IDEA_KINDS, IdeaKind, Member } from '../entities';
import { CreateIdeaDto, UpdateIdeaDto } from './ideas.dto';
import { IdeasService } from './ideas.service';

@Controller('trips/:tripId/ideas')
@UseGuards(MemberGuard)
export class IdeasController {
  constructor(private readonly ideas: IdeasService) {}

  @Get()
  list(
    @Param('tripId') tripId: string,
    @CurrentMember() me: Member,
    @Query('kind') kind?: string,
  ) {
    const k = IDEA_KINDS.includes(kind as IdeaKind)
      ? (kind as IdeaKind)
      : undefined;
    return this.ideas.list(tripId, me, k);
  }

  @Post()
  create(
    @Param('tripId') tripId: string,
    @CurrentMember() me: Member,
    @Body() dto: CreateIdeaDto,
  ) {
    return this.ideas.create(tripId, me, dto);
  }

  @Patch(':ideaId')
  update(
    @Param('tripId') tripId: string,
    @Param('ideaId') ideaId: string,
    @CurrentMember() me: Member,
    @Body() dto: UpdateIdeaDto,
  ) {
    return this.ideas.update(tripId, me, ideaId, dto);
  }

  @Delete(':ideaId')
  @HttpCode(204)
  remove(
    @Param('tripId') tripId: string,
    @Param('ideaId') ideaId: string,
    @CurrentMember() me: Member,
  ) {
    return this.ideas.remove(tripId, me, ideaId);
  }

  @Post(':ideaId/vote')
  vote(
    @Param('tripId') tripId: string,
    @Param('ideaId') ideaId: string,
    @CurrentMember() me: Member,
  ) {
    return this.ideas.toggleVote(tripId, me, ideaId);
  }
}
