import { IsNotEmpty } from 'class-validator';

export class RequestPasswordResetDto {
  @IsNotEmpty()
  readonly email: string;
}
