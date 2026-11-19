import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UploadedFiles,
  UseGuards,
} from '@nestjs/common';
import { MemberGuard } from '../common/member.guard';
import { CurrentMember } from '../common/current-member.decorator';
import { Member } from '../entities';
import { PhotoUpload } from '../photos/photo-upload';
import { UploadPhotoDto } from '../photos/photos.dto';
import type { UploadedFiles as Files } from '../photos/photos.service';
import {
  AddChallengeDto,
  EditChallengeDto,
  GameStateDto,
  OverruleDto,
} from './selfies.dto';
import { SelfiesService } from './selfies.service';

/** The selfie game: a list of selfies to take on the trip, judged and scored. */
@Controller('trips/:tripId/selfies')
@UseGuards(MemberGuard)
export class SelfiesController {
  constructor(private readonly selfies: SelfiesService) {}

  @Get()
  view(@CurrentMember() me: Member) {
    return this.selfies.view(me);
  }

  /** Upload a selfie for a challenge (same files as an album upload). */
  @Post('challenges/:challengeId/entries')
  @PhotoUpload()
  submit(
    @Param('challengeId', ParseUUIDPipe) challengeId: string,
    @CurrentMember() me: Member,
    @UploadedFiles() files: Files | undefined,
    @Body() dto: UploadPhotoDto,
  ) {
    return this.selfies.submit(me, challengeId, files, dto);
  }

  // ---- organizer ----

  @Put('state')
  state(@CurrentMember() me: Member, @Body() dto: GameStateDto) {
    return this.selfies.setOn(me, dto.on);
  }

  @Post('regenerate')
  @HttpCode(200)
  regenerate(@CurrentMember() me: Member) {
    return this.selfies.regenerate(me);
  }

  @Post('challenges')
  add(@CurrentMember() me: Member, @Body() dto: AddChallengeDto) {
    return this.selfies.addChallenge(me, dto);
  }

  @Patch('challenges/:challengeId')
  edit(
    @Param('challengeId', ParseUUIDPipe) challengeId: string,
    @CurrentMember() me: Member,
    @Body() dto: EditChallengeDto,
  ) {
    return this.selfies.editChallenge(me, challengeId, dto);
  }

  @Delete('challenges/:challengeId')
  remove(
    @Param('challengeId', ParseUUIDPipe) challengeId: string,
    @CurrentMember() me: Member,
  ) {
    return this.selfies.removeChallenge(me, challengeId);
  }

  /** Swap one challenge for a fresh AI idea. */
  @Post('challenges/:challengeId/replace')
  @HttpCode(200)
  replace(
    @Param('challengeId', ParseUUIDPipe) challengeId: string,
    @CurrentMember() me: Member,
  ) {
    return this.selfies.replaceChallenge(me, challengeId);
  }

  /** Count a selfie the AI turned down, or take one off the board. */
  @Put('entries/:entryId')
  overrule(
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @CurrentMember() me: Member,
    @Body() dto: OverruleDto,
  ) {
    return this.selfies.overrule(me, entryId, dto.status);
  }
}
