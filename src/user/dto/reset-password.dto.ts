import { IsNotEmpty } from 'class-validator';

export class ResetPasswordDto {
  @IsNotEmpty()
  readonly token: string;

  @IsNotEmpty()
  readonly password: string;
}
