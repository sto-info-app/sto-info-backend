import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

import { CreateStoArmadaDto } from './create-sto-armada.dto';

/**
 * Changes an Armada's own settings.
 *
 * **The platform cannot be changed**, for the reason a Fleet's cannot: it is
 * half of the slug's uniqueness scope and half of the canonical URL, so
 * moving an Armada between platforms would re-mint its slug in a scope the
 * retired one does not cover and leave every old link pointing nowhere. It
 * would also strand the Fleets placed in it, which are on the platform the
 * Armada was registered against.
 */
export class UpdateStoArmadaDto extends PartialType(
  OmitType(CreateStoArmadaDto, ['platformId'] as const),
) {
  /**
   * The revision the caller last saw, for optimistic concurrency.
   *
   * Optional, because a client that has not read the Armada cannot supply
   * one and refusing it outright would make a correction impossible.
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
