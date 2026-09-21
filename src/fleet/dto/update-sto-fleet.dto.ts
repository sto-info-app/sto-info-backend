import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

import { CreateStoFleetDto } from './create-sto-fleet.dto';

/**
 * Changes a Fleet's own settings.
 *
 * **The platform cannot be changed.** It is half of the slug's uniqueness
 * scope and half of the canonical URL, so moving a Fleet between platforms
 * would have to re-mint the slug in a scope the retired one does not cover,
 * leaving every old link pointing nowhere. A Fleet registered against the
 * wrong platform is closed and registered again, which costs one record and
 * keeps the addresses honest.
 *
 * The exact game name can be changed, because Fleets are renamed in game and
 * the record has to be able to follow. Doing so re-mints the slug and leaves
 * the old one behind as a redirect.
 */
export class UpdateStoFleetDto extends PartialType(
  OmitType(CreateStoFleetDto, ['platformId'] as const),
) {
  /**
   * The revision the caller last saw, for optimistic concurrency.
   *
   * Optional, because a client that has not read the Fleet cannot supply one
   * and refusing it outright would make a correction impossible. Supplying it
   * is what turns a blind overwrite into a refusal the caller can act on.
   */
  @ApiPropertyOptional({
    description: 'The revision the caller last saw.',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly revision?: number;
}
