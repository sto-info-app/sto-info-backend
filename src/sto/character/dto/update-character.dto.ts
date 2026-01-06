import { PartialType } from '@nestjs/swagger';
import { CreateCharacterRequestDto } from './create-character-request.dto';

export class UpdateCharacterDto extends PartialType(
  CreateCharacterRequestDto,
) {}
