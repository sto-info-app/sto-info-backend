import { PartialType } from '@nestjs/mapped-types';
import { CreateLauncherDto } from './create-launcher.dto';

export class UpdateLauncherDto extends PartialType(CreateLauncherDto) {}
