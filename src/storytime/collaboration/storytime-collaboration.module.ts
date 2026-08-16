import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorytimeStoryCollaboratorEntity } from '../crew/entities/storytime-story-collaborator.entity';
import { StorytimeCollaboratorAccessService } from './storytime-collaborator-access.service';

/**
 * Who may act on somebody else's Story.
 *
 * Deliberately the smallest module in the feature: it holds the capability
 * lookup and nothing else. Stories import it to decide access, and the Crew
 * module — which manages invitations and needs Stories to check who is
 * inviting — sits above both. The dependency runs one way and never loops.
 */
@Module({
  imports: [TypeOrmModule.forFeature([StorytimeStoryCollaboratorEntity])],
  providers: [StorytimeCollaboratorAccessService],
  exports: [StorytimeCollaboratorAccessService],
})
export class StorytimeCollaborationModule {}
