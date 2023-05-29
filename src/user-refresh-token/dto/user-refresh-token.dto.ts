import { IsNotEmpty } from 'class-validator';

export class UserRefreshTokenDto {
  @IsNotEmpty()
  readonly refresh_token: string;
}
