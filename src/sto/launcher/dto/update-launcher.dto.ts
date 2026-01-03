import { PartialType } from '@nestjs/swagger';
import { CreateLauncherDto } from './create-launcher.dto';

export class UpdateLauncherDto extends PartialType(CreateLauncherDto) {}
