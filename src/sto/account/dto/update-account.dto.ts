import { PartialType } from '@nestjs/mapped-types';
import { CreateAccountRequestDto } from './create-account-request.dto';

export class UpdateAccountDto extends PartialType(CreateAccountRequestDto) {}
