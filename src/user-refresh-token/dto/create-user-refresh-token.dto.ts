import { IsNotEmpty } from 'class-validator';
import { User } from 'src/user/entities/user.entity';

export class CreateUserRefreshTokenDto {
  @IsNotEmpty()
  user: User;

  @IsNotEmpty()
  tokenId: string;

  @IsNotEmpty()
  jwtId: string;

  @IsNotEmpty()
  isRevoked: boolean;

  @IsNotEmpty()
  expiresAt: Date;
}
