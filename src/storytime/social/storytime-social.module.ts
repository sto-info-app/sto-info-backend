import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeAuthorModule } from '../shared/storytime-author.module';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeActivityFeedItemEntity } from './entities/storytime-activity-feed-item.entity';
import { StorytimeArcFollowEntity } from './entities/storytime-arc-follow.entity';
import { StorytimeCommentEntity } from './entities/storytime-comment.entity';
import { StorytimeCreatorFollowEntity } from './entities/storytime-creator-follow.entity';
import { StorytimeFeedStateEntity } from './entities/storytime-feed-state.entity';
import { StorytimeReactionEntity } from './entities/storytime-reaction.entity';
import { StorytimeStoryFollowEntity } from './entities/storytime-story-follow.entity';
import { StorytimeActivityFeedService } from './storytime-activity-feed.service';
import { StorytimeCommentMapper } from './storytime-comment.mapper';
import { StorytimeCommentService } from './storytime-comment.service';
import { StorytimeCommentsController } from './storytime-comments.controller';
import { StorytimeFollowService } from './storytime-follow.service';
import { StorytimeFollowsController } from './storytime-follows.controller';
import { StorytimeReactionService } from './storytime-reaction.service';
import { StorytimeReactionsController } from './storytime-reactions.controller';
import { StorytimeSocialMapper } from './storytime-social.mapper';

/**
 * What readers do with Storytime content beyond reading it.
 *
 * Registers the content tables directly rather than importing their modules.
 * Reactions write counts back through the entity manager, and comments read
 * ownership to decide who may hide one — both are bookkeeping about a Story
 * rather than changes to it, and going through the Story service would mean
 * claiming to edit somebody else's Story every time a reader pressed a
 * button.
 */
@Module({
  imports: [
    StorytimeAuthorModule,
    TypeOrmModule.forFeature([
      StorytimeReactionEntity,
      StorytimeCommentEntity,
      StorytimeStoryEntity,
      StorytimeChapterEntity,
      StorytimeArcEntity,
      StorytimeCreatorFollowEntity,
      StorytimeStoryFollowEntity,
      StorytimeArcFollowEntity,
      StorytimeActivityFeedItemEntity,
      StorytimeFeedStateEntity,
    ]),
  ],
  controllers: [
    StorytimeReactionsController,
    StorytimeCommentsController,
    StorytimeFollowsController,
  ],
  providers: [
    StorytimeReactionService,
    StorytimeCommentService,
    StorytimeCommentMapper,
    StorytimeFollowService,
    StorytimeActivityFeedService,
    StorytimeSocialMapper,
  ],
  exports: [
    StorytimeReactionService,
    StorytimeCommentService,
    StorytimeCommentMapper,
    StorytimeFollowService,
    StorytimeActivityFeedService,
  ],
})
export class StorytimeSocialModule {}
