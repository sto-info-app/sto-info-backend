import { PartialType } from '@nestjs/mapped-types';
import { CreatePlatformLauncherDto } from './create-platform-launcher.dto';

export class UpdatePlatformLauncherDto extends PartialType(CreatePlatformLauncherDto) {}
