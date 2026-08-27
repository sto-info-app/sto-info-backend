import { ApiProperty } from '@nestjs/swagger';
import { CharacterDto } from './character.dto';

/**
 * A Character's appearance in a Chapter, as readers see it.
 */
export class ChapterAppearanceDto {
  @ApiProperty({ description: 'The Chapter they appear in.' })
  chapterId: string;

  @ApiProperty({ description: 'Position within the Chapter’s cast list.' })
  appearanceOrder: number;

  @ApiProperty({
    description: 'Whether they are central to this Chapter.',
  })
  isPrimary: boolean;

  @ApiProperty({
    description: 'What they do in this Chapter.',
    nullable: true,
  })
  appearanceNotes: string | null;

  @ApiProperty({
    type: CharacterDto,
    nullable: true,
    description:
      'The Character, when one was asked for. Null when the row refers to a Character that has since been deleted.',
  })
  character: CharacterDto | null;
}
