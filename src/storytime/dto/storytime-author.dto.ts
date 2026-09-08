import { ApiProperty } from '@nestjs/swagger';

/**
 * The member who published a work, as a reader is shown them.
 *
 * The two fields travel together because neither is any use alone: the name is
 * what a reader is told, and whether they are listed decides whether that name
 * leads anywhere. A work whose author has closed their account carries no
 * author at all rather than a name with nothing behind it.
 */
export class StorytimeAuthorDto {
  @ApiProperty({ description: 'Their registry username.' })
  readonly username: string;

  @ApiProperty({
    description:
      'Whether they have chosen to be listed in the registry, and so ' +
      'whether their profile can be linked to.',
  })
  readonly publiclyVisible: boolean;
}
