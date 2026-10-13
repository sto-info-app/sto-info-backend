import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index } from 'typeorm';

import { StorytimeCollaboratorEntity } from '../../shared/entities/storytime-collaborator.entity';

/**
 * Somebody the owner has invited to help write a Story.
 *
 * This table, and only this table, decides who may edit a Story besides its
 * owner. A Crew credit is public acknowledgement and confers nothing: the two
 * are deliberately separate, so thanking somebody in the credits can never
 * hand them the keys.
 *
 * Access comes only from an `ACCEPTED` invitation. An invitation nobody has
 * answered grants nothing, which is what stops an owner from quietly adding
 * somebody to a Story without their agreement. The invitation columns are
 * shared with Arc collaboration through {@link StorytimeCollaboratorEntity}.
 */
@Entity({ name: 'storytime_story_collaborator' })
@Index(['userId', 'invitationStatus'])
export class StorytimeStoryCollaboratorEntity extends StorytimeCollaboratorEntity {
  @ApiProperty({ description: 'The Story being collaborated on.' })
  @Column({ type: 'uuid', nullable: false })
  storyId: string;

  @ApiProperty({ description: 'May change the Story’s own details.' })
  @Column({ type: 'boolean', nullable: false, default: false })
  canEditStory: boolean;

  @ApiProperty({ description: 'May write and edit Chapters.' })
  @Column({ type: 'boolean', nullable: false, default: false })
  canManageChapters: boolean;

  @ApiProperty({ description: 'May manage the cast.' })
  @Column({ type: 'boolean', nullable: false, default: false })
  canManageCharacters: boolean;

  @ApiProperty({ description: 'May manage Crew credits.' })
  @Column({ type: 'boolean', nullable: false, default: false })
  canManageCrew: boolean;
}
