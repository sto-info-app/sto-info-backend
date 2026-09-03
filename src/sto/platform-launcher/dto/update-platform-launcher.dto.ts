import { PartialType } from '@nestjs/swagger';

import { CreatePlatformLauncherDto } from './create-platform-launcher.dto';

export class UpdatePlatformLauncherDto extends PartialType(
  CreatePlatformLauncherDto,
) {}
