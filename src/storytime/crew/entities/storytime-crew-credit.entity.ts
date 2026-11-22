import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index } from 'typeorm';

import { CrewCreditScope } from '../../enums/crew-credit-scope.enum';
import { StorytimeModeratedEntity } from '../../shared/entities/storytime-moderated.entity';

/**
 * Public acknowledgement of somebody's contribution.
 *
 * One table for all three scopes rather than three tables, because a credit is
 * the same thing wherever it hangs: a person, a role, and what they did it to.
 * Which scope a row is at is derived from which of `chapterId` and
 * `characterId` are set, so the two can never disagree.
 *
 * A credit confers nothing. Edit access comes only from an accepted
 * collaboration, so thanking somebody in the credits can never hand them the
 * keys to the Story.
 *
 * The moderation and audit columns are shared with the works it credits
 * through {@link StorytimeModeratedEntity}.
 */
@Entity({ name: 'storytime_crew_credit' })
@Index(['storyId', 'orderIndex'])
@Index(['userId'])
export class StorytimeCrewCreditEntity extends StorytimeModeratedEntity {
  @ApiProperty({ description: 'The Story credited in. Always required.' })
  @Column({ type: 'uuid', nullable: false })
  storyId: string;

  @ApiProperty({
    description: 'The Chapter, when the credit is for one in particular.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  chapterId: string | null;

  @ApiProperty({
    description: 'The Character, when the credit is for one in particular.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  characterId: string | null;

  @ApiProperty({ description: 'The person being credited.' })
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ApiProperty({ description: 'The role they are credited in.' })
  @Column({ type: 'uuid', nullable: false })
  roleId: string;

  @ApiProperty({
    description:
      'Wording to use instead of the role name, for a credit the roles do not word well.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  creditLabel: string | null;

  @ApiProperty({ description: 'Notes shown with the credit.', nullable: true })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  notes: string | null;

  @ApiProperty({ description: 'Position within the credits.' })
  @Column({ type: 'integer', nullable: false, default: 0 })
  orderIndex: number;

  @ApiProperty({
    description: 'The Chapter this credit starts applying from.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  validFromChapterId: string | null;

  @ApiProperty({
    description: 'The Chapter this credit stops applying after.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  validToChapterId: string | null;

  /**
   * What this credit attaches to.
   *
   * Derived rather than stored, so the scope and the identifiers can never
   * come to disagree about what a row means.
   *
   * @returns The credit's scope.
   */
  get scope(): CrewCreditScope {
    if (this.characterId) {
      return CrewCreditScope.CHARACTER;
    }

    return this.chapterId ? CrewCreditScope.CHAPTER : CrewCreditScope.STORY;
  }
}
