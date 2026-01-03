import { PartialType } from '@nestjs/swagger';
import { CreatePlatformDto } from './create-platform.dto';

export class UpdatePlatformDto extends PartialType(CreatePlatformDto) {}
