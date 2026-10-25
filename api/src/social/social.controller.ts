import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MemberGuard } from '../common/member.guard';
import { CurrentMember } from '../common/current-member.decorator';
import { Member } from '../entities';
import { ActivityService } from '../activity/activity.service';
import { CreateCommentDto, CreatePostDto, ReactDto } from './social.dto';
import { SocialService } from './social.service';

@Controller('trips/:tripId')
@UseGuards(MemberGuard)
export class SocialController {
  constructor(
    private readonly social: SocialService,
    private readonly activity: ActivityService,
  ) {}

  @Get('activity')
  activityFeed(
    @Param('tripId') tripId: string,
    @Query('limit') limit?: string,
  ) {
    const n = Math.min(Math.max(Number(limit) || 40, 1), 200);
    return this.activity.recent(tripId, n);
  }

  @Get('posts')
  posts(@Param('tripId') tripId: string, @CurrentMember() me: Member) {
    return this.social.listPosts(tripId, me);
  }

  @Post('posts')
  createPost(
    @Param('tripId') tripId: string,
    @CurrentMember() me: Member,
    @Body() dto: CreatePostDto,
  ) {
    return this.social.createPost(tripId, me, dto.body);
  }

  @Post('posts/:postId/react')
  react(
    @Param('tripId') tripId: string,
    @Param('postId') postId: string,
    @CurrentMember() me: Member,
    @Body() dto: ReactDto,
  ) {
    return this.social.toggleReaction(tripId, me, postId, dto.emoji);
  }

  @Delete('posts/:postId')
  @HttpCode(204)
  deletePost(
    @Param('tripId') tripId: string,
    @Param('postId') postId: string,
    @CurrentMember() me: Member,
  ) {
    return this.social.deletePost(tripId, me, postId);
  }

  @Get('ideas/:ideaId/comments')
  comments(@Param('tripId') tripId: string, @Param('ideaId') ideaId: string) {
    return this.social.listComments(tripId, ideaId);
  }

  @Post('ideas/:ideaId/comments')
  addComment(
    @Param('tripId') tripId: string,
    @Param('ideaId') ideaId: string,
    @CurrentMember() me: Member,
    @Body() dto: CreateCommentDto,
  ) {
    return this.social.addComment(tripId, me, ideaId, dto.body);
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  deleteComment(
    @Param('tripId') tripId: string,
    @Param('commentId') commentId: string,
    @CurrentMember() me: Member,
  ) {
    return this.social.deleteComment(tripId, me, commentId);
  }
}
