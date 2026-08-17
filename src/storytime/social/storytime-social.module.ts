import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeCommentEntity } from './entities/storytime-comment.entity';
import { StorytimeReactionEntity } from './entities/storytime-reaction.entity';
import { StorytimeCommentMapper } from './storytime-comment.mapper';
import { StorytimeCommentService } from './storytime-comment.service';
import { StorytimeCommentsController } from './storytime-comments.controller';
import { StorytimeReactionService } from './storytime-reaction.service';
import { StorytimeReactionsController } from './storytime-reactions.controller';

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
    TypeOrmModule.forFeature([
      StorytimeReactionEntity,
      StorytimeCommentEntity,
      StorytimeStoryEntity,
      StorytimeChapterEntity,
      StorytimeArcEntity,
    ]),
  ],
  controllers: [StorytimeReactionsController, StorytimeCommentsController],
  providers: [
    StorytimeReactionService,
    StorytimeCommentService,
    StorytimeCommentMapper,
  ],
  exports: [
    StorytimeReactionService,
    StorytimeCommentService,
    StorytimeCommentMapper,
  ],
})
export class StorytimeSocialModule {}
