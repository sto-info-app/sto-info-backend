import { IsNotEmpty, IsUUID } from 'class-validator';

import { CreateAccountRequestDto } from './create-account-request.dto';

export class CreateAccountDto extends CreateAccountRequestDto {
  @IsNotEmpty()
  @IsUUID()
  readonly userId: string;
}
