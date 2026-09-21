import { ApiProperty } from '@nestjs/swagger';

import { Equals, IsBoolean, IsUUID, Validate } from 'class-validator';

import { IsExactGameNameConstraint } from '../utilities/is-exact-game-name.constraint';

/**
 * Confirms an unregistered Fleet: a record of a Fleet nobody here runs.
 *
 * It exists so an imported roster has something to attach to when the Fleet
 * it describes belongs to nobody on this site. Such a record has no owner,
 * no scope and no capability held at it, which has consequences worth being
 * plain about:
 *
 * - **Nobody can change it and nobody can close it.** Every mutating route
 *   in this feature checks a capability at a scope, and an unregistered
 *   Fleet resolves to no scope at all. Correcting one is an administrator's
 *   job, and adopting one into a Community is FC-039's.
 * - **It has no web address.** The slug index and the Armada composite key
 *   both require a Community, so it appears in searches and in duplicate
 *   warnings and is reachable nowhere else.
 *
 * Which is why {@link confirmUnregistered} has to be sent, and has to be
 * true. It is not a checkbox for its own sake: creating one of these is
 * almost always a mistake by somebody who meant to register their own Fleet,
 * and an explicit flag is the difference between a considered act and a
 * mis-posted form. The API refuses a request that does not carry it rather
 * than assuming the caller meant it.
 */
export class CreateUnregisteredFleetDto {
  @ApiProperty({
    description:
      'The Fleet name exactly as it appears in game, including any leading ' +
      'or trailing space.',
  })
  @Validate(IsExactGameNameConstraint)
  readonly exactGameName: string;

  @ApiProperty({ description: 'The platform the Fleet exists on.' })
  @IsUUID()
  readonly platformId: string;

  @ApiProperty({
    description:
      'Must be true. Confirms the caller knows this record will belong to ' +
      'no Community, and that nobody will be able to change or close it.',
  })
  @IsBoolean()
  @Equals(true, {
    message:
      'Confirm that this Fleet belongs to no Community on this site, and ' +
      'that nobody will be able to change or close the record afterwards.',
  })
  readonly confirmUnregistered: boolean;
}
