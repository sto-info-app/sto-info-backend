import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorytimeReactionEntity } from './entities/storytime-reaction.entity';
import { StorytimeReactionService } from './storytime-reaction.service';
import { StorytimeReactionsController } from './storytime-reactions.controller';

/**
 * What readers do with Storytime content beyond reading it.
 *
 * Registers only its own table. Reactions write counts back onto Stories,
 * Chapters and Arcs through the entity manager rather than through their
 * services, because a count is bookkeeping about a Story rather than a change
 * to it — and going through the Story service would mean claiming to edit
 * somebody else's Story every time a reader pressed a button.
 */
@Module({
  imports: [TypeOrmModule.forFeature([StorytimeReactionEntity])],
  controllers: [StorytimeReactionsController],
  providers: [StorytimeReactionService],
  exports: [StorytimeReactionService],
})
export class StorytimeSocialModule {}
