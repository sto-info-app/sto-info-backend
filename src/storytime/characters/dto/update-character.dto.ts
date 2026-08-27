import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { CreateCharacterDto } from './create-character.dto';

/**
 * Updates a Character.
 */
export class UpdateCharacterDto extends PartialType(CreateCharacterDto) {
  @ApiPropertyOptional({
    description:
      'The version the client last saw. When supplied and out of date the update is rejected rather than overwriting somebody else’s edit.',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly version?: number;
}
