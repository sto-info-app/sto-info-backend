import { IsNotEmpty } from 'class-validator';

export class ResendVerificationEmailDto {
  @IsNotEmpty()
  readonly token: string;
}
