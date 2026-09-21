import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

import { CreateFleetCommunityDto } from './create-fleet-community.dto';

/**
 * Changes a Fleet Community's own settings.
 *
 * Every registration field is optional here and nothing else is added, so
 * ownership, status and the authorisation revision cannot be set by a request:
 * transferring ownership and closing the Community are separate actions with
 * their own capabilities, and the revision is the server's own bookkeeping.
 *
 * Renaming mints a new slug and leaves the old one behind as a redirect, so a
 * link posted in Discord six months ago still resolves — ADR-0022.
 */
export class UpdateFleetCommunityDto extends PartialType(
  CreateFleetCommunityDto,
) {
  @ApiPropertyOptional({
    description:
      'The revision the client last saw. When supplied and out of date the ' +
      'update is refused rather than overwriting somebody else’s edit.',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly revision?: number;
}
