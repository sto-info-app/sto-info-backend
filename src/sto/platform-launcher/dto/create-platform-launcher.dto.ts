import { IsNotEmpty, IsUUID } from 'class-validator';

export class CreatePlatformLauncherDto {
  @IsNotEmpty()
  @IsUUID()
  readonly platformId: string;

  @IsNotEmpty()
  @IsUUID()
  readonly launcherId: string;
}
