import { IsNotEmpty, IsString } from 'class-validator';

export class CreateLauncherDto {
  @IsNotEmpty()
  @IsString()
  readonly name: string;
}
