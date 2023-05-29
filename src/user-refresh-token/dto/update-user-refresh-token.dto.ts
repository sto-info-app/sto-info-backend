import { PartialType } from '@nestjs/swagger';
import { CreateUserRefreshTokenDto } from './create-user-refresh-token.dto';

export class UpdateUserRefreshTokenDto extends PartialType(
  CreateUserRefreshTokenDto,
) {}
