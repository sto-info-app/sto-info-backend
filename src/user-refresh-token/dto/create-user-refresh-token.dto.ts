import { IsNotEmpty } from 'class-validator';

import { UserEntity } from 'src/user/entities/user.entity';

export class CreateUserRefreshTokenDto {
  @IsNotEmpty()
  user: UserEntity;

  @IsNotEmpty()
  tokenId: string;

  @IsNotEmpty()
  jwtId: string;

  @IsNotEmpty()
  isRevoked: boolean;

  @IsNotEmpty()
  expiresAt: Date;
}
