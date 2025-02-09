import { IsNotEmpty, IsString } from 'class-validator';

export class CreatePlatformDto {
  @IsNotEmpty()
  @IsString()
  readonly name: string;
}
