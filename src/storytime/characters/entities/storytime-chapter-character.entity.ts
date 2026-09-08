import { ApiProperty } from '@nestjs/swagger';

import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * A Character's appearance in a Chapter.
 *
 * The pair is the key: a Character either appears in a Chapter or does not,
 * and appearing twice is not a thing that can be said.
 *
 * That the Chapter and the Character belong to the same Story is enforced in
 * the service rather than the schema. Guaranteeing it in the database would
 * need a redundant `storyId` on this table plus composite foreign keys, which
 * buys a rule the service already keeps at the cost of a column that could
 * itself go stale. It is covered by its own test.
 *
 * There are no soft-delete columns. Removing an appearance is a correction —
 * the Character was never in that Chapter — and nothing is served by keeping a
 * record of a statement the creator has withdrawn.
 */
@Entity({ name: 'storytime_chapter_character' })
export class StorytimeChapterCharacterEntity {
  @ApiProperty({ description: 'The Chapter they appear in.' })
  @PrimaryColumn({ type: 'uuid' })
  chapterId: string;

  @ApiProperty({ description: 'The Character appearing.' })
  @PrimaryColumn({ type: 'uuid' })
  characterId: string;

  @ApiProperty({
    description: 'Position within the Chapter’s cast list.',
  })
  @Column({ type: 'integer', nullable: false, default: 0 })
  appearanceOrder: number;

  @ApiProperty({
    description: 'What they do in this Chapter, for the creator’s own notes.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  appearanceNotes: string | null;

  @ApiProperty({
    description: 'Whether they are central to this particular Chapter.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  isPrimary: boolean;

  @ApiProperty({ description: 'User who recorded the appearance.' })
  @Column({ type: 'uuid', nullable: false })
  createdByUserId: string;

  @CreateDateColumn()
  createdAt: Date;
}
