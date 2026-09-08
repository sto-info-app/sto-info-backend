import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StorytimeArcCollaboratorEntity } from '../arcs/entities/storytime-arc-collaborator.entity';
import { StorytimeStoryCollaboratorEntity } from '../crew/entities/storytime-story-collaborator.entity';
import { StorytimeArcCollaboratorAccessService } from './storytime-arc-collaborator-access.service';
import { StorytimeCollaboratorAccessService } from './storytime-collaborator-access.service';

/**
 * Who may act on somebody else's Story or Arc.
 *
 * Deliberately the smallest module in the feature: it holds the two capability
 * lookups and nothing else. Stories and Arcs import it to decide access, while
 * the modules that manage invitations — which need Stories and Arcs to check
 * who is inviting — sit above both. The dependency runs one way and never
 * loops, which is the whole reason this module is separate.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StorytimeStoryCollaboratorEntity,
      StorytimeArcCollaboratorEntity,
    ]),
  ],
  providers: [
    StorytimeCollaboratorAccessService,
    StorytimeArcCollaboratorAccessService,
  ],
  exports: [
    StorytimeCollaboratorAccessService,
    StorytimeArcCollaboratorAccessService,
  ],
})
export class StorytimeCollaborationModule {}
